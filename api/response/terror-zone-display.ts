export interface TerrorZoneDisplay {
  zone: string;
  startTime: number;
  immunities: string;
  lootTier: string;
}

export interface TerrorZoneDisplayPayload {
  currentTerrorZone: TerrorZoneDisplay;
  nextTerrorZone: TerrorZoneDisplay;
}
