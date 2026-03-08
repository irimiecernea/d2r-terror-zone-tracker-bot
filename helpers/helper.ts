import { TerrorApiResponseFailure } from '../api/response/failure-api-response.js';
import { TerrorApiResponseSuccess, TerrorApiZoneEntry } from '../api/response/success-api-response.js';
import { PersistedTrackedTerrorMessage, TrackedTerrorMessage } from '../api/response/tracked-terror-message.js';
import { TerrorZoneDisplayPayload } from '../api/response/terror-zone-display.js';

interface HelperConfig {
  nextZoneLoadingPlaceholder: string;
  immunitiesLoadingPlaceholder: string;
  immunityEmojiMap: Record<string, string>;
}

export class Helper {
  private readonly nextZoneLoadingPlaceholder: string;
  private readonly immunitiesLoadingPlaceholder: string;
  private readonly immunityEmojiMap: Record<string, string>;

  /**
   * Creates helper with static mapping/config data used across conversions.
   * @param config Placeholder strings and immunity emoji dictionary.
   */
  constructor(config: HelperConfig) {
    this.nextZoneLoadingPlaceholder = config.nextZoneLoadingPlaceholder;
    this.immunitiesLoadingPlaceholder = config.immunitiesLoadingPlaceholder;
    this.immunityEmojiMap = config.immunityEmojiMap;
  }

  /**
   * Type guard that narrows mixed API responses to success payload shape.
   * @param data API response union.
   * @returns `true` when response is success payload.
   */
  isSuccessResponse(
    data: TerrorApiResponseSuccess | TerrorApiResponseFailure,
  ): data is TerrorApiResponseSuccess {
    return !('message' in data);
  }

  /**
   * Converts an absolute Unix timestamp to a timeout delay in milliseconds.
   * Delay is clamped to at least 1000ms.
   * @param targetUnixSeconds Target Unix time (seconds).
   * @param offsetSeconds Optional offset in seconds.
   */
  toDelayMs(targetUnixSeconds: number, offsetSeconds = 0): number {
    const targetMs = (targetUnixSeconds + offsetSeconds) * 1000;
    return Math.max(1000, targetMs - Date.now());
  }

  /**
   * Converts in-memory tracked message state into persisted JSON shape.
   * @param message In-memory tracked message entry.
   */
  toPersistedTrackedMessage(message: TrackedTerrorMessage): PersistedTrackedTerrorMessage {
    return {
      messageId: message.messageId,
      guildId: message.guildId,
      channelId: message.channelId,
      currentTerrorZone: message.currentTerrorZone,
      nextTerrorZone: message.nextTerrorZone,
    };
  }

  /**
   * Finds the first tracked message entry for a guild.
   * @param trackedMessages Source map keyed by message id.
   * @param guildId Guild id to search.
   * @returns Tuple `[messageId, trackedMessage]` or `null`.
   */
  findTrackedMessageByGuildId(
    trackedMessages: Map<string, TrackedTerrorMessage>,
    guildId: string,
  ): [string, TrackedTerrorMessage] | null {
    for (const entry of trackedMessages.entries()) {
      if (entry[1].guildId === guildId) return entry;
    }
    return null;
  }

  /**
   * Maps raw API response entries into display payload (`current` and `next` zones).
   * Applies loading placeholders when next zone is not present.
   * @param apiData Raw success response array from API.
   */
  mapApiDataToDisplayPayload(apiData: TerrorApiResponseSuccess): TerrorZoneDisplayPayload | null {
    if (apiData.length === 0) return null;

    const now = Math.floor(Date.now() / 1000);
    const sortedByTime = [...apiData].sort((a, b) => a.time - b.time);

    const current =
      sortedByTime.find(entry => entry.time <= now && now < entry.end_time) ??
      [...sortedByTime].reverse().find(entry => entry.time <= now) ??
      sortedByTime[0];

    const next = sortedByTime.find(entry => entry.time > current.time);

    return {
      currentTerrorZone: this.mapZoneEntry(current),
      nextTerrorZone: next
        ? this.mapZoneEntry(next)
        : {
            zone: this.nextZoneLoadingPlaceholder,
            startTime: current.end_time,
            immunities: this.immunitiesLoadingPlaceholder,
          },
    };
  }

  /**
   * Validates and normalizes parsed store data into persisted tracked entries.
   * Invalid items are skipped; missing optional fields receive defaults.
   * @param parsed JSON-parsed store value.
   */
  parsePersistedTrackedMessages(parsed: unknown): PersistedTrackedTerrorMessage[] {
    if (!Array.isArray(parsed)) return [];

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
                : this.immunitiesLoadingPlaceholder,
          },
        }),
      );
  }

  /**
   * Maps one API zone entry into display fields for embeds/storage.
   * Includes zone text formatting and immunity code-to-emoji conversion.
   * @param entry Single raw zone entry.
   */
  private mapZoneEntry(entry: TerrorApiZoneEntry): TerrorZoneDisplayPayload['currentTerrorZone'] {
    const immunityIcons = entry.immunities
      .map(code => this.immunityEmojiMap[code] ?? `\`${code}\``)
      .join(' ');

    return {
      zone: entry.zone_name.map(name => name.replace(/_/g, ' ')).join(', '),
      startTime: entry.time,
      immunities: immunityIcons || 'Unknown',
    };
  }
}
