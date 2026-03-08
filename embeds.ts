import { TerrorApiResponseFailure } from './api/response/failure-api-response.js';
import { TerrorZoneDisplayPayload } from './api/response/terror-zone-display.js';
import { EmbedBuilder } from 'discord.js';

export class Embeds {
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

            const successEmbed = new EmbedBuilder()
                .setColor(0x9900FF)
                .setTitle('--- Terror Zone Status ---')
                .addFields(
                    { name: 'Now Terrorized:', value: current.zone },
                    { name: 'Immunities:', value: current.immunities },
                    { name: 'Since:', value: current.startTime > 0 ? `<t:${current.startTime}:t>` : 'Unknown' },
                    { name: '\u200B', value: '\u200B' },
                    { name: 'Next:', value: next.zone },
                    { name: 'Immunities:', value: next.immunities },
                    { name: 'Starting:', value: next.zone === '⏳ Refreshing...' || next.startTime <= 0 ? '⏳ Refreshing...' : `<t:${next.startTime}:R>` },
                )
                .setFooter({ text: 'Bot created by volkunus. Data courtesy of d2tz.info' });

            return successEmbed;
        }
    }
}
