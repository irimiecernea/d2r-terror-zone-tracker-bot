export interface TerrorApiResponseSuccess {
    currentTerrorZone: { zone: string; act: string };
    nextTerrorZone: { zone: string; act: string };
    providedBy?: string;
}