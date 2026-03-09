import { TerrorZoneDisplay } from './terror-zone-display.js';

export interface TrackedTerrorMessage {
  messageId: string;
  guildId: string;
  channelId: string;
  currentTerrorZone: TerrorZoneDisplay;
  nextTerrorZone: TerrorZoneDisplay;
  boundaryTimer?: NodeJS.Timeout;
  confirmTimer?: NodeJS.Timeout;
}

export interface PersistedTrackedTerrorMessage {
  messageId: string;
  guildId: string;
  channelId: string;
  currentTerrorZone: TerrorZoneDisplay;
  nextTerrorZone: TerrorZoneDisplay;
}
