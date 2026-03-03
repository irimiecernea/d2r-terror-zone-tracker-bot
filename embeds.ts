import { TerrorApiResponse } from './api/response/api-response.js';
import { EmbedBuilder } from 'discord.js';

export class Embeds {

    buildTerrorZoneEmbed(data: TerrorApiResponse): EmbedBuilder {
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