import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { REST, Routes, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { APIRequest } from './api/request/api-request.js';
import { Embeds } from './embeds.js';
import {
  PersistedTrackedTerrorMessage,
  TrackedTerrorMessage,
} from './api/response/tracked-terror-message.js';
import { Helper } from './helpers/helper.js';
import {
  IMMUNITY_EMOJI_MAP,
  MAX_CONFIRM_REFRESH_DELAY_SECONDS,
  MIN_CONFIRM_REFRESH_DELAY_SECONDS,
  TERROR_ZONE_LOADING_PLACEHOLDER,
} from './constants.js';

const TOKEN = process.env.TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const API_URL = process.env.API_URL?.trim();
const API_TOKEN = process.env.API_TOKEN?.trim();
const CONFIRM_REFRESH_DELAY_SECONDS_RAW = process.env.CONFIRM_REFRESH_DELAY_SECONDS?.trim();

if (!TOKEN) throw new Error('Missing TOKEN');
if (!CLIENT_ID) throw new Error('Missing CLIENT_ID');
if (!API_URL) throw new Error('Missing API_URL');
if (!API_TOKEN) throw new Error('Missing API_TOKEN');
if (!CONFIRM_REFRESH_DELAY_SECONDS_RAW) throw new Error('Missing CONFIRM_REFRESH_DELAY_SECONDS');

const CONFIRM_REFRESH_DELAY_SECONDS = (() => {
  const parsed = Number(CONFIRM_REFRESH_DELAY_SECONDS_RAW);
  const isInteger = Number.isInteger(parsed);
  const isInRange =
    parsed >= MIN_CONFIRM_REFRESH_DELAY_SECONDS && parsed <= MAX_CONFIRM_REFRESH_DELAY_SECONDS;

  if (!isInteger || !isInRange) {
    throw new Error(
      `Invalid CONFIRM_REFRESH_DELAY_SECONDS. Expected an integer between ${MIN_CONFIRM_REFRESH_DELAY_SECONDS} and ${MAX_CONFIRM_REFRESH_DELAY_SECONDS} (seconds).`,
    );
  }

  return parsed;
})();

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
const TRACKED_MESSAGES_STORE_PATH = join(process.cwd(), 'data', 'terrorized-store.json');

const trackedMessages = new Map<string, TrackedTerrorMessage>();
let globalBoundaryTimer: NodeJS.Timeout | undefined;
let globalConfirmTimer: NodeJS.Timeout | undefined;
let expectedCurrentStartTimeAfterBoundary: number | null = null;
const terrorZoneHelper = new Helper({
  loadingPlaceholder: TERROR_ZONE_LOADING_PLACEHOLDER,
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
  await mkdir(dirname(TRACKED_MESSAGES_STORE_PATH), { recursive: true });
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

  if (trackedMessages.size === 0) {
    if (globalBoundaryTimer) clearTimeout(globalBoundaryTimer);
    if (globalConfirmTimer) clearTimeout(globalConfirmTimer);
    globalBoundaryTimer = undefined;
    globalConfirmTimer = undefined;
    expectedCurrentStartTimeAfterBoundary = null;
  }

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
 * Applies one mapped payload to every tracked message in memory.
 * @param mappedData Shared mapped payload from a single API response.
 */
function applyMappedDataToAllTrackedMessages(mappedData: ReturnType<Helper['mapApiDataToDisplayPayload']>): void {
  if (!mappedData) return;
  for (const tracked of trackedMessages.values()) {
    tracked.currentTerrorZone = mappedData.currentTerrorZone;
    tracked.nextTerrorZone = mappedData.nextTerrorZone;
  }
}

/**
 * Edits all tracked Discord messages with current in-memory state.
 */
async function editAllTrackedMessages(): Promise<void> {
  const messageIds = [...trackedMessages.keys()];
  await Promise.allSettled(messageIds.map(messageId => editTrackedMessage(messageId)));
}

/**
 * Clears and recreates global boundary/confirm timers from a shared next start timestamp.
 * @param nextStartUnixSeconds Shared next zone start timestamp (seconds).
 */
function scheduleGlobalTimers(nextStartUnixSeconds: number): void {
  if (globalBoundaryTimer) clearTimeout(globalBoundaryTimer);
  if (globalConfirmTimer) clearTimeout(globalConfirmTimer);
  globalBoundaryTimer = undefined;
  globalConfirmTimer = undefined;

  if (trackedMessages.size === 0 || nextStartUnixSeconds <= 0) return;

  globalBoundaryTimer = setTimeout(() => {
    for (const tracked of trackedMessages.values()) {
      if (tracked.nextTerrorZone.zone !== TERROR_ZONE_LOADING_PLACEHOLDER) {
        tracked.currentTerrorZone = tracked.nextTerrorZone;
      }

      tracked.nextTerrorZone = {
        zone: TERROR_ZONE_LOADING_PLACEHOLDER,
        startTime: 0,
        immunities: TERROR_ZONE_LOADING_PLACEHOLDER,
        lootTier: TERROR_ZONE_LOADING_PLACEHOLDER,
      };
    }

    expectedCurrentStartTimeAfterBoundary = nextStartUnixSeconds;

    saveTrackedMessagesToStore().catch(error => {
      console.error('Failed to persist tracked terrorized messages after boundary update:', error);
    });
    editAllTrackedMessages().catch(error => {
      console.error('Failed to edit tracked terrorized messages after boundary update:', error);
    });

    globalConfirmTimer = setTimeout(() => {
      refreshAllFromApi().catch(error => {
        console.error('Confirm refresh failed for tracked terrorized messages:', error);
      });
    }, terrorZoneHelper.toDelayMs(nextStartUnixSeconds, CONFIRM_REFRESH_DELAY_SECONDS));
  }, terrorZoneHelper.toDelayMs(nextStartUnixSeconds));
}

/**
 * Refreshes all tracked messages using one shared API call.
 * Handles retries for API failures/empty payloads/stale confirmations,
 * then persists state, edits messages, and reschedules global timers.
 */
async function refreshAllFromApi(): Promise<void> {
  if (trackedMessages.size === 0) return;
  const trackedCount = trackedMessages.size;
  const avoidedCalls = Math.max(0, trackedCount - 1);

  const apiData = await apiRequest.fetchTerrorZone();
  if (!terrorZoneHelper.isSuccessResponse(apiData)) {
    console.log(`[refresh] tracked=${trackedCount}, api_calls=1, avoided=${avoidedCalls}`);
    console.error(`Failed shared refresh for tracked terrorized messages: ${apiData.message}`);
    globalConfirmTimer = setTimeout(() => {
      refreshAllFromApi().catch(error => {
        console.error('Retry shared refresh failed for tracked terrorized messages:', error);
      });
    }, 30_000);
    return;
  }

  const mappedData = terrorZoneHelper.mapApiDataToDisplayPayload(apiData);
  if (!mappedData) {
    console.log(`[refresh] tracked=${trackedCount}, api_calls=1, avoided=${avoidedCalls}`);
    console.error('No zone entries returned for shared tracked terrorized refresh.');
    globalConfirmTimer = setTimeout(() => {
      refreshAllFromApi().catch(error => {
        console.error('Retry shared refresh failed for tracked terrorized messages:', error);
      });
    }, 30_000);
    return;
  }

  const isStaleConfirmation =
    expectedCurrentStartTimeAfterBoundary !== null &&
    mappedData.currentTerrorZone.startTime > 0 &&
    mappedData.currentTerrorZone.startTime < expectedCurrentStartTimeAfterBoundary;

  if (isStaleConfirmation) {
    globalConfirmTimer = setTimeout(() => {
      refreshAllFromApi().catch(error => {
        console.error('Retry shared refresh failed for tracked terrorized messages:', error);
      });
    }, 30_000);
    return;
  }

  applyMappedDataToAllTrackedMessages(mappedData);
  console.log(`[refresh] tracked=${trackedCount}, api_calls=1, avoided=${avoidedCalls}`);
  expectedCurrentStartTimeAfterBoundary = null;

  try {
    await saveTrackedMessagesToStore();
  } catch (error) {
    console.error('Failed to persist tracked terrorized messages after refresh:', error);
  }

  await editAllTrackedMessages();
  scheduleGlobalTimers(mappedData.nextTerrorZone.startTime);
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
      }

      console.log(`Loaded ${entries.length} tracked terrorized message(s) from store.`);
      refreshAllFromApi().catch(error => {
        console.error('Startup shared refresh failed for tracked terrorized messages:', error);
      });
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
    scheduleGlobalTimers(mappedData.nextTerrorZone.startTime);
  }
});

await client.login(TOKEN);
