import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REST, Routes, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { APIRequest } from './api/request/api-request.js';
import { Embeds } from './embeds.js';
import { TerrorApiResponseFailure } from './api/response/failure-api-response.js';
import { TerrorApiResponseSuccess, TerrorApiZoneEntry } from './api/response/success-api-response.js';
import { TerrorZoneDisplayPayload } from './api/response/terror-zone-display.js';
import {
  PersistedTrackedTerrorMessage,
  TrackedTerrorMessage,
} from './api/response/tracked-terror-message.js';

const TOKEN = process.env.TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const API_URL = process.env.API_URL?.trim();
const API_TOKEN = process.env.API_TOKEN?.trim();

if (!TOKEN) throw new Error('Missing TOKEN');
if (!CLIENT_ID) throw new Error('Missing CLIENT_ID');
if (!API_URL) throw new Error('Missing API_URL');
if (!API_TOKEN) throw new Error('Missing API_TOKEN');

const commands = [
  {
    name: 'terrorized',
    description: 'Replies the current and upcoming Terror Zones.',
  },
  {
    name: 'terrorized-remove',
    description: 'Removes the Terror Zones tracker message for this server.',
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
const apiRequest = new APIRequest(API_URL, API_TOKEN);
const embeds = new Embeds();
const TRACKED_MESSAGES_STORE_PATH = join(process.cwd(), 'terrorized-store.json');
const NEXT_ZONE_LOADING_PLACEHOLDER = '⏳ Refreshing...';
const IMMUNITIES_LOADING_PLACEHOLDER = '⏳ Refreshing...';
const CONFIRM_REFRESH_DELAY_SECONDS = 90;
const IMMUNITY_EMOJI_MAP: Record<string, string> = {
  f: ':fire:',
  c: ':snowflake:',
  l: ':zap:',
  p: ':test_tube:',
  ph: ':crossed_swords:',
  m: ':sparkles:',
};

const trackedMessages = new Map<string, TrackedTerrorMessage>();

function isSuccessResponse(
  data: TerrorApiResponseSuccess | TerrorApiResponseFailure,
): data is TerrorApiResponseSuccess {
  return !('message' in data);
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toDelayMs(targetUnixSeconds: number, offsetSeconds = 0): number {
  const targetMs = (targetUnixSeconds + offsetSeconds) * 1000;
  return Math.max(1000, targetMs - Date.now());
}

function toPersistedTrackedMessage(
  message: TrackedTerrorMessage,
): PersistedTrackedTerrorMessage {
  return {
    messageId: message.messageId,
    guildId: message.guildId,
    channelId: message.channelId,
    currentTerrorZone: message.currentTerrorZone,
    nextTerrorZone: message.nextTerrorZone,
  };
}

function findTrackedMessageByGuildId(guildId: string): [string, TrackedTerrorMessage] | null {
  for (const entry of trackedMessages.entries()) {
    if (entry[1].guildId === guildId) return entry;
  }
  return null;
}

function mapZoneEntry(entry: TerrorApiZoneEntry): TerrorZoneDisplayPayload['currentTerrorZone'] {
  const immunityIcons = entry.immunities
    .map(code => IMMUNITY_EMOJI_MAP[code] ?? `\`${code}\``)
    .join(' ');

  return {
    zone: entry.zone_name.map(name => name.replace(/_/g, ' ')).join(', '),
    startTime: entry.time,
    immunities: immunityIcons || 'Unknown',
  };
}

function mapApiDataToDisplayPayload(apiData: TerrorApiResponseSuccess): TerrorZoneDisplayPayload | null {
  if (apiData.length === 0) return null;

  const now = nowUnixSeconds();
  const sortedByTime = [...apiData].sort((a, b) => a.time - b.time);

  const current =
    sortedByTime.find(entry => entry.time <= now && now < entry.end_time) ??
    [...sortedByTime].reverse().find(entry => entry.time <= now) ??
    sortedByTime[0];

  const next = sortedByTime.find(entry => entry.time > current.time);

  return {
    currentTerrorZone: mapZoneEntry(current),
    nextTerrorZone: next
      ? mapZoneEntry(next)
      : {
          zone: NEXT_ZONE_LOADING_PLACEHOLDER,
          startTime: current.end_time,
          immunities: IMMUNITIES_LOADING_PLACEHOLDER,
        },
  };
}

async function loadTrackedMessagesFromStore(): Promise<PersistedTrackedTerrorMessage[]> {
  try {
    const rawContent = await readFile(TRACKED_MESSAGES_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(rawContent);

    if (!Array.isArray(parsed)) {
      console.warn('terrorized-store.json is not an array. Starting with empty tracked messages.');
      return [];
    }

    return parsed
      .filter(entry => {
        return Boolean(
          entry &&
            typeof entry.messageId === 'string' &&
            typeof entry.channelId === 'string' &&
            entry.currentTerrorZone &&
            typeof entry.currentTerrorZone.zone === 'string' &&
            entry.nextTerrorZone &&
            typeof entry.nextTerrorZone.zone === 'string',
        );
      })
      .map(
        (entry): PersistedTrackedTerrorMessage => ({
          messageId: entry.messageId,
          guildId: typeof entry.guildId === 'string' ? entry.guildId : 'unknown',
          channelId: entry.channelId,
          currentTerrorZone: {
            zone: entry.currentTerrorZone.zone,
            startTime: typeof entry.currentTerrorZone.startTime === 'number' ? entry.currentTerrorZone.startTime : 0,
            immunities:
              typeof entry.currentTerrorZone.immunities === 'string'
                ? entry.currentTerrorZone.immunities
                : 'Unknown',
          },
          nextTerrorZone: {
            zone: entry.nextTerrorZone.zone,
            startTime: typeof entry.nextTerrorZone.startTime === 'number' ? entry.nextTerrorZone.startTime : 0,
            immunities:
              typeof entry.nextTerrorZone.immunities === 'string'
                ? entry.nextTerrorZone.immunities
                : IMMUNITIES_LOADING_PLACEHOLDER,
          },
        }),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    console.error('Failed to read terrorized-store.json:', error);
    return [];
  }
}

async function saveTrackedMessagesToStore(): Promise<void> {
  const serializableEntries = Array.from(trackedMessages.values()).map(toPersistedTrackedMessage);
  await writeFile(TRACKED_MESSAGES_STORE_PATH, JSON.stringify(serializableEntries, null, 2), 'utf-8');
}

function stopTracking(messageId: string): void {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  if (tracked.boundaryTimer) clearTimeout(tracked.boundaryTimer);
  if (tracked.confirmTimer) clearTimeout(tracked.confirmTimer);
  trackedMessages.delete(messageId);
  saveTrackedMessagesToStore().catch(error => {
    console.error('Failed to persist tracked terrorized messages after removal:', error);
  });
}

async function canCreateTrackedMessageForGuild(guildId: string): Promise<boolean> {
  const existing = findTrackedMessageByGuildId(guildId);
  if (!existing) return true;

  const [messageId, tracked] = existing;

  try {
    const channel = await client.channels.fetch(tracked.channelId);
    if (!channel?.isTextBased()) {
      stopTracking(messageId);
      return true;
    }

    await channel.messages.fetch(messageId);
    return false;
  } catch {
    stopTracking(messageId);
    return true;
  }
}

async function removeTrackedMessageForGuild(guildId: string): Promise<boolean> {
  const existing = findTrackedMessageByGuildId(guildId);
  if (!existing) return false;

  const [messageId, tracked] = existing;

  try {
    const channel = await client.channels.fetch(tracked.channelId);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    }
  } catch (error) {
    console.warn(`Could not delete tracked terrorized message ${messageId}:`, error);
  } finally {
    stopTracking(messageId);
  }

  return true;
}

async function editTrackedMessage(messageId: string): Promise<void> {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  try {
    const channel = await client.channels.fetch(tracked.channelId);
    if (!channel?.isTextBased()) {
      stopTracking(messageId);
      return;
    }

    const message = await channel.messages.fetch(messageId);
    await message.edit({
      embeds: [
        embeds.buildTerrorZoneEmbed({
          currentTerrorZone: tracked.currentTerrorZone,
          nextTerrorZone: tracked.nextTerrorZone,
        }),
      ],
    });
  } catch (error) {
    console.error(`Failed to edit tracked terrorized message ${messageId}:`, error);
    stopTracking(messageId);
  }
}

async function refreshFromApi(messageId: string): Promise<void> {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  const apiData = await apiRequest.fetchTerrorZone();
  if (!isSuccessResponse(apiData)) {
    console.error(`Failed refresh for tracked terrorized message ${messageId}: ${apiData.message}`);
    tracked.confirmTimer = setTimeout(() => {
      refreshFromApi(messageId).catch(error => {
        console.error(`Retry refresh failed for message ${messageId}:`, error);
      });
    }, 30_000);
    return;
  }

  const mappedData = mapApiDataToDisplayPayload(apiData);
  if (!mappedData) {
    console.error(`No zone entries returned for message ${messageId}.`);
    tracked.confirmTimer = setTimeout(() => {
      refreshFromApi(messageId).catch(error => {
        console.error(`Retry refresh failed for message ${messageId}:`, error);
      });
    }, 30_000);
    return;
  }

  const isAwaitingBoundaryConfirmation = tracked.nextTerrorZone.zone === NEXT_ZONE_LOADING_PLACEHOLDER;
  const isStaleConfirmation =
    isAwaitingBoundaryConfirmation &&
    mappedData.currentTerrorZone.startTime > 0 &&
    tracked.currentTerrorZone.startTime > 0 &&
    mappedData.currentTerrorZone.startTime < tracked.currentTerrorZone.startTime;

  if (isStaleConfirmation) {
    tracked.confirmTimer = setTimeout(() => {
      refreshFromApi(messageId).catch(error => {
        console.error(`Retry refresh failed for message ${messageId}:`, error);
      });
    }, 30_000);
    return;
  }

  tracked.currentTerrorZone = mappedData.currentTerrorZone;
  tracked.nextTerrorZone = mappedData.nextTerrorZone;

  try {
    await saveTrackedMessagesToStore();
  } catch (error) {
    console.error('Failed to persist tracked terrorized messages after refresh:', error);
  }

  await editTrackedMessage(messageId);
  scheduleBoundaryUpdate(messageId);
}

function scheduleConfirmRefresh(messageId: string, startedAtUnixSeconds: number): void {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  const delayMs = toDelayMs(startedAtUnixSeconds, CONFIRM_REFRESH_DELAY_SECONDS);
  tracked.confirmTimer = setTimeout(() => {
    refreshFromApi(messageId).catch(error => {
      console.error(`Confirm refresh failed for message ${messageId}:`, error);
    });
  }, delayMs);
}

function scheduleBoundaryUpdate(messageId: string): void {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  if (tracked.boundaryTimer) clearTimeout(tracked.boundaryTimer);
  if (tracked.confirmTimer) clearTimeout(tracked.confirmTimer);

  const boundaryStartTime = tracked.nextTerrorZone.startTime;
  if (boundaryStartTime <= 0) {
    tracked.confirmTimer = setTimeout(() => {
      refreshFromApi(messageId).catch(error => {
        console.error(`Boundary recovery refresh failed for message ${messageId}:`, error);
      });
    }, 30_000);
    return;
  }

  tracked.boundaryTimer = setTimeout(() => {
    const latest = trackedMessages.get(messageId);
    if (!latest) return;

    if (latest.nextTerrorZone.zone !== NEXT_ZONE_LOADING_PLACEHOLDER) {
      latest.currentTerrorZone = latest.nextTerrorZone;
    }

    latest.nextTerrorZone = {
      zone: NEXT_ZONE_LOADING_PLACEHOLDER,
      startTime: 0,
      immunities: IMMUNITIES_LOADING_PLACEHOLDER,
    };

    saveTrackedMessagesToStore().catch(error => {
      console.error('Failed to persist tracked terrorized messages after boundary update:', error);
    });

    editTrackedMessage(messageId).catch(error => {
      console.error(`Boundary edit failed for message ${messageId}:`, error);
    });

    scheduleConfirmRefresh(messageId, boundaryStartTime);
  }, toDelayMs(boundaryStartTime));
}

try {
  console.log('Started refreshing application (/) commands.');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
} catch (error) {
  console.error(error);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
  readyClient.user.setPresence({ activities: [{ name: 'Diablo 2 Resurrected' }] });

  loadTrackedMessagesFromStore()
    .then(entries => {
      for (const entry of entries) {
        trackedMessages.set(entry.messageId, { ...entry });
        scheduleBoundaryUpdate(entry.messageId);
        refreshFromApi(entry.messageId).catch(error => {
          console.error(`Startup refresh failed for message ${entry.messageId}:`, error);
        });
      }

      console.log(`Loaded ${entries.length} tracked terrorized message(s) from store.`);
    })
    .catch(error => {
      console.error('Failed to restore tracked terrorized messages on startup:', error);
    });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'terrorized-remove') {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const removed = await removeTrackedMessageForGuild(interaction.guildId);
    await interaction.reply({
      content: removed
        ? 'Terrorized tracker message removed for this Discord Server.'
        : 'No active terrorized tracker was found for this Discord Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'terrorized') {
    if (interaction.guildId) {
      const canCreate = await canCreateTrackedMessageForGuild(interaction.guildId);
      if (!canCreate) {
        await interaction.reply({
          content: 'A terrorized tracker already exists in this Discord Server. Please use that existing message.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const terrorZoneData = await apiRequest.fetchTerrorZone();
    const mappedData = isSuccessResponse(terrorZoneData)
      ? mapApiDataToDisplayPayload(terrorZoneData)
      : null;

    await interaction.reply({
      embeds: [
        embeds.buildTerrorZoneEmbed(
          mappedData ??
            (isSuccessResponse(terrorZoneData)
              ? { status: 'error', message: 'API returned no terror zone entries.' }
              : terrorZoneData),
        ),
      ],
    });

    if (!mappedData) return;
    const reply = await interaction.fetchReply();

    const tracked: TrackedTerrorMessage = {
      messageId: reply.id,
      guildId: interaction.guildId ?? 'dm',
      channelId: reply.channelId,
      currentTerrorZone: mappedData.currentTerrorZone,
      nextTerrorZone: mappedData.nextTerrorZone,
    };

    trackedMessages.set(reply.id, tracked);
    saveTrackedMessagesToStore().catch(error => {
      console.error('Failed to persist tracked terrorized messages after command:', error);
    });
    scheduleBoundaryUpdate(reply.id);
  }
});

await client.login(TOKEN);
