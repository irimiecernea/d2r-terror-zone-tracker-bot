import { TerrorApiResponseFailure } from './api/response/failure-api-response.js';
import { TerrorZoneDisplayPayload } from './api/response/terror-zone-display.js';
import { EmbedBuilder } from 'discord.js';
import { TERROR_ZONE_LOADING_PLACEHOLDER } from './constants.js';

export class Embeds {
    /**
     * Builds the Discord embed used for `/terrorized` replies and tracker edits.
     * Accepts either success display payload or failure payload from API flow.
     * @param data Mapped terror zone payload or API failure payload.
     */
    buildTerrorZoneEmbed(data: TerrorZoneDisplayPayload | TerrorApiResponseFailure): EmbedBuilder {
        if ('message' in data) {
            const failureEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Error fetching Terror Zone data from API')
                .setDescription(data.message)
                .setFooter({ text: 'Data provided by API' });

            return failureEmbed;
        } else {
            const current = data.currentTerrorZone;
            const next = data.nextTerrorZone;
            const nextZoneValue =
                next.zone === TERROR_ZONE_LOADING_PLACEHOLDER ? next.zone : `***${next.zone}***`;
            const nextLootTierValue =
                next.lootTier === TERROR_ZONE_LOADING_PLACEHOLDER ? next.lootTier : `**${next.lootTier}**`;

            const successEmbed = new EmbedBuilder()
                .setColor(0x9900FF)
                .setTitle('---------- Terror Zone Status ----------')
                .addFields(
                    { name: 'Corrupted tremors strike', value: `***${current.zone}***` },
                    { name: 'Immunities:', value: current.immunities },
                    { name: 'Loot Tier:', value: `**${current.lootTier}**` },
                    { name: 'Started:', value: current.startTime > 0 ? `<t:${current.startTime}:R>` : 'Unknown' },
                    { name: '\u200B', value: '\u200B' },
                    { name: 'Next', value: nextZoneValue },
                    { name: 'Immunities:', value: next.immunities },
                    { name: 'Loot Tier:', value: nextLootTierValue },
                    {
                        name: 'Starting:',
                        value:
                            next.zone === TERROR_ZONE_LOADING_PLACEHOLDER || next.startTime <= 0
                                ? TERROR_ZONE_LOADING_PLACEHOLDER
                                : `<t:${next.startTime}:R>`,
                    },
                )
                .setFooter({ text: 'Bot created by volkunus. Data courtesy of d2tz.info' });

            return successEmbed;
        }
    }
}
