import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REST, Routes, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { APIRequest } from './api/request/api-request.js';
import { Embeds } from './embeds.js';
import {
  PersistedTrackedTerrorMessage,
  TrackedTerrorMessage,
} from './api/response/tracked-terror-message.js';
import { Helper } from './helpers/helper.js';

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
const terrorZoneHelper = new Helper({
  nextZoneLoadingPlaceholder: NEXT_ZONE_LOADING_PLACEHOLDER,
  immunitiesLoadingPlaceholder: IMMUNITIES_LOADING_PLACEHOLDER,
  immunityEmojiMap: IMMUNITY_EMOJI_MAP,
});

/**
 * Loads tracked message entries from `terrorized-store.json`.
 * Parsed data is validated/normalized through `TerrorZoneHelper`.
 * Returns an empty array when file is missing or unreadable.
 */
async function loadTrackedMessagesFromStore(): Promise<PersistedTrackedTerrorMessage[]> {
  try {
    const rawContent = await readFile(TRACKED_MESSAGES_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(rawContent);

    const entries = terrorZoneHelper.parsePersistedTrackedMessages(parsed);
    if (!Array.isArray(parsed)) {
      console.warn('terrorized-store.json is not an array. Starting with empty tracked messages.');
      return entries;
    }

    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    console.error('Failed to read terrorized-store.json:', error);
    return [];
  }
}

/**
 * Persists the in-memory tracked message map to `terrorized-store.json`.
 */
async function saveTrackedMessagesToStore(): Promise<void> {
  const serializableEntries = Array.from(trackedMessages.values()).map(message =>
    terrorZoneHelper.toPersistedTrackedMessage(message),
  );
  await writeFile(TRACKED_MESSAGES_STORE_PATH, JSON.stringify(serializableEntries, null, 2), 'utf-8');
}

/**
 * Stops tracking a message.
 * Clears both timers, removes the entry from memory, and persists the store update.
 * @param messageId Discord message id used as tracking key.
 */
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

/**
 * Checks if a guild can create a new tracker message.
 * If an existing tracked message is stale/unavailable, it is removed and creation is allowed.
 * @param guildId Discord guild id.
 * @returns `true` if tracker creation is allowed, otherwise `false`.
 */
async function canCreateTrackedMessageForGuild(guildId: string): Promise<boolean> {
  const existing = terrorZoneHelper.findTrackedMessageByGuildId(trackedMessages, guildId);
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

/**
 * Removes the active tracked message for a guild.
 * Attempts Discord message deletion first, then always clears local tracking/state.
 * @param guildId Discord guild id.
 * @returns `true` when a tracked entry existed and was removed, else `false`.
 */
async function removeTrackedMessageForGuild(guildId: string): Promise<boolean> {
  const existing = terrorZoneHelper.findTrackedMessageByGuildId(trackedMessages, guildId);
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

/**
 * Updates an existing tracked Discord message embed using current in-memory zone data.
 * If message/channel is no longer accessible, the tracker entry is removed.
 * @param messageId Discord message id to edit.
 */
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

/**
 * Refreshes tracked data from API for one message.
 * Handles retries for API failures/empty payloads/stale confirmations,
 * persists state, edits message content, then schedules next boundary update.
 * @param messageId Discord message id tied to tracker state.
 */
async function refreshFromApi(messageId: string): Promise<void> {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  const apiData = await apiRequest.fetchTerrorZone();
  if (!terrorZoneHelper.isSuccessResponse(apiData)) {
    console.error(`Failed refresh for tracked terrorized message ${messageId}: ${apiData.message}`);
    tracked.confirmTimer = setTimeout(() => {
      refreshFromApi(messageId).catch(error => {
        console.error(`Retry refresh failed for message ${messageId}:`, error);
      });
    }, 30_000);
    return;
  }

  const mappedData = terrorZoneHelper.mapApiDataToDisplayPayload(apiData);
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

/**
 * Schedules the confirmation API refresh after a boundary transition.
 * @param messageId Discord message id tied to tracker state.
 * @param startedAtUnixSeconds Unix timestamp (seconds) of the boundary start time.
 */
function scheduleConfirmRefresh(messageId: string, startedAtUnixSeconds: number): void {
  const tracked = trackedMessages.get(messageId);
  if (!tracked) return;

  const delayMs = terrorZoneHelper.toDelayMs(startedAtUnixSeconds, CONFIRM_REFRESH_DELAY_SECONDS);
  tracked.confirmTimer = setTimeout(() => {
    refreshFromApi(messageId).catch(error => {
      console.error(`Confirm refresh failed for message ${messageId}:`, error);
    });
  }, delayMs);
}

/**
 * Schedules the next boundary swap based on `nextTerrorZone.startTime`.
 * On boundary trigger, promotes next->current, sets loading placeholder for next,
 * persists state, edits message, and schedules confirmation refresh.
 * @param messageId Discord message id tied to tracker state.
 */
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
  }, terrorZoneHelper.toDelayMs(boundaryStartTime));
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
    const mappedData = terrorZoneHelper.isSuccessResponse(terrorZoneData)
      ? terrorZoneHelper.mapApiDataToDisplayPayload(terrorZoneData)
      : null;

    await interaction.reply({
      embeds: [
        embeds.buildTerrorZoneEmbed(
          mappedData ??
            (terrorZoneHelper.isSuccessResponse(terrorZoneData)
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
