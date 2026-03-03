import 'dotenv/config';
import { REST, Routes, Client, Events, GatewayIntentBits } from 'discord.js';
import { APIRequest } from './api/request/api-request.js';
import { Embeds } from './embeds.js';

const TOKEN = process.env.TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const API_URL = process.env.API_URL?.trim();
const API_TOKEN = process.env.API_TOKEN?.trim();

if (!TOKEN) throw new Error('Missing TOKEN');
if (!CLIENT_ID) throw new Error('Missing CLIENT_ID');
if (!API_URL) throw new Error('Missing API_URL');
if (!API_TOKEN) throw new Error('Missing API_TOKEN');

const commands = [
  {
    name: 'terrorized',
    description: 'Replies the current and upcoming Terror Zones.',
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
const apiRequest = new APIRequest(API_URL, API_TOKEN);
const embeds = new Embeds();

try {
  console.log('Started refreshing application (/) commands.');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Successfully reloaded application (/) commands.');
} catch (error) {
  console.error(error);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
  readyClient.user.setPresence({ activities: [{ name: 'Diablo 2 Resurrected' }] });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'terrorized') {
    const terrorZoneData = await apiRequest.fetchTerrorZone();
    await interaction.reply({ embeds: [embeds.buildTerrorZoneEmbed(terrorZoneData)] });
  }
});

await client.login(TOKEN);