export interface TerrorZoneDisplay {
  zone: string;
  startTime: number;
  immunities: string;
}

export interface TerrorZoneDisplayPayload {
  currentTerrorZone: TerrorZoneDisplay;
  nextTerrorZone: TerrorZoneDisplay;
}
