const { EmbedBuilder } = require('discord.js');
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const Database = require("@replit/database")
const fetch = require('isomorphic-fetch');
let endOfHour = require('date-fns/endOfHour')
const db = new Database();
let zone;
let amount;
let formattedAct;
let lastReportMiliseconds;

const cron = require('node-cron');
// re-setting amount in database, to avoid caching forever
cron.schedule('0 * * * *', () => {
  db.set("amount", '0').then(() => {
    console.log(`Re-setting amount to 0 in the database.`);
    console.log(new Date());
  });
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'terrorized') {
    let amountDb = await db.get("amount").then(value => {
      return value;
    });
    let currentDateTimestamp = new Date().getTime() / 1000
    currentDateTimestamp = currentDateTimestamp.toString().split('.')[0];
    let lastRequestTimestamp = await getLastRequestTimestampFromDb();
    let guildIdDatabase = await getGuildIdFromDatabase();
    let currentGuildId = interaction.guildId;
    let endOfCurrentHour = endOfHour(new Date());
    endOfCurrentHour = endOfCurrentHour / 1000;
    let endOfHourTimestamp = endOfCurrentHour.toString().split('.')[0];
    if (currentDateTimestamp - lastRequestTimestamp > 59 || guildIdDatabase !== currentGuildId) {
      if (new Date().getMinutes() < 10 || amountDb < 5) {
        await getCurrentTerrorZoneData().then(data => {
          db.set("guildId", interaction.guildId).then(() => { });
          let act = data.terrorZone.act;
          amount = data.terrorZone.highestProbabilityZone.amount;
          zone = amount >= 3 ? data.terrorZone.highestProbabilityZone.zone : data.terrorZone.zone;
          formattedAct = act.slice(-1);
          lastReportMiliseconds = data.terrorZone.lastUpdate.seconds;
          db.set("amount", amount).then(() => { });
          db.set("zone", zone).then(() => { });
          db.set("formattedAct", formattedAct).then(() => { });
          db.set("lastReportMiliseconds", lastReportMiliseconds).then(() => { });
        })
        setCurrentTimestampInDb()
        console.log(`Data served from API because amount in database is <= ${amountDb}`);
      } else {
        zone = await db.get("zone").then(value => {
          return value;
        });
        amount = await db.get("amount").then(value => {
          return value;
        });
        formattedAct = await db.get("formattedAct").then(value => {
          return value;
        });
        lastReportMiliseconds = await db.get("lastReportMiliseconds").then(value => {
          return value;
        });
        setCurrentTimestampInDb()
        console.log(`Data served from DB because amount is >= ${amountDb}`);
      }
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x9900FF)
        .setTitle('Terror Zone Tracker Report')
        .setURL('https://d2runewizard.com/terror-zone-tracker')
        .setDescription('A detailed report of the currently terrorized zone in Diablo 2: Resurrected')
        .setThumbnail('https://media.moddb.com/images/members/5/4358/4357203/profile/d2r.jpg')
        .addFields(
          { name: 'Terrorized zone(s):', value: zone },
          { name: 'Act:', value: formattedAct },
          { name: 'Confirmed by:', value: `${amount} user(s)`, inline: true },
          { name: 'Last user report:', value: `<t:${lastReportMiliseconds}:R>`, inline: true },
          { name: 'Zone will change:', value: `<t:${endOfHourTimestamp}:R>` }
        )
        .setFooter({ text: 'Bot created by volkunus#7863. Data provided by https://d2runewizard.com/terror-zone-tracker' });

      await interaction.reply({ embeds: [exampleEmbed] });
    } else {
      interaction.reply(`The \`/terrorized\` command can only be used once every 60 seconds. Last successful command was used <t:${lastRequestTimestamp}:R>. Try again shortly.`)
    }
  }
});

function setCurrentTimestampInDb() {
  let lastRequestTimestamp = new Date().getTime() / 1000
  lastRequestTimestamp = lastRequestTimestamp.toString().split('.')[0];
  db.set("lastRequestTimestamp", lastRequestTimestamp).then(() => {
  });
}

function getLastRequestTimestampFromDb() {
  return db.get("lastRequestTimestamp").then(value => {
    return value;
  });
}

function getGuildIdFromDatabase() {
  return db.get("guildId").then(value => {
    return value;
  });
}

async function getCurrentTerrorZoneData() {
  return fetch("https://d2runewizard.com/api/terror-zone")
    .then(res => {
      return res.json()
    }).then(data => {
      return data
    })
}

client.login(process.env.TOKEN);