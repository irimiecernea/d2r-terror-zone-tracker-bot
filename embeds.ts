import { TerrorApiResponseFailure } from './api/response/failure-api-response.js';
import { TerrorApiResponseSuccess } from './api/response/success-api-response.js';
import { EmbedBuilder } from 'discord.js';

export class Embeds {

    buildTerrorZoneEmbed(data: TerrorApiResponseSuccess | TerrorApiResponseFailure): EmbedBuilder {

        if ('message' in data) {
            const failureEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Error fetching Terror Zone data from API')
                .setDescription(data.message)
                .setFooter({ text: `Data provided by ${data.providedBy}, version ${data.version}` });

            return failureEmbed;
        } else {
            const current = data.currentTerrorZone;
            const next = data.nextTerrorZone;

            const successEmbed = new EmbedBuilder()
                .setColor(0x9900FF)
                .setTitle('Terror Zones')
                .setURL('https://d2runewizard.com/terror-zone-tracker')
                .addFields(
                    { name: 'Currently terrorized zone(s):', value: current.zone },
                    { name: 'Act:', value: `${current.act.slice(-1)}` },
                    { name: 'Next terrorized zone:', value: next.zone },
                    { name: 'Act:', value: `${next.act.slice(-1)}` },
                )
                .setFooter({ text: 'Bot created by volkunus. Data provided by https://d2runewizard.com/terror-zone-tracker' });

            return successEmbed;
        }
    }
}