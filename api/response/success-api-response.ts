export interface TerrorApiZoneEntry {
    time: number;
    zone_name: string[];
    immunities: string[];
    'tier-exp': string;
    'tier-loot': string;
    area_id: number;
    area_ids: number[];
    end_time: number;
}

export type TerrorApiResponseSuccess = TerrorApiZoneEntry[];
