# D2R Terror Zone Tracker Bot

Discord bot that posts and auto-updates Diablo 2 Resurrected Terror Zones using the [https://www.d2tz.info](d2tz.info) API.

## Features

- Slash command `/terrorized` posts current and next terrorized zones.
- Message auto-updates when zone rotation changes.
- Confirmation refresh runs after rotation to sync with API updates.
- A single API call is made per zone update, even if the bot is part of multiple guilds.
- Immunities are displayed with emoji mapping:
  - `f` -> `:fire:`
  - `c` -> `:snowflake:`
  - `l` -> `:zap:`
  - `p` -> `:test_tube:`
  - `ph` -> `:crossed_swords:`
  - `m` -> `:sparkles:`
- One active tracker message per guild.
- Slash command `/terrorized-remove` removes the guild tracker and clears it from store.
- Persistent tracker store in `terrorized-store.json` so trackers survive restarts.

## Requirements

- [nvm](https://github.com/nvm-sh/nvm)
- A Discord application + bot token
- An API Authorization token from [https://www.d2tz.info](d2tz.info)

## Environment Variables

Create `.env` in project root:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
API_URL=https://api.d2tz.info/public/tz
API_TOKEN=your_api_token
```

## Install

```bash
nvm use
npm install
```

## Run

Production:

```bash
npm start
```

Development (watch built file):

```bash
npm run build
npm run dev
```

## Commands

- `/terrorized`
  - Creates a tracker message for the current guild (if none exists).
- `/terrorized-remove`
  - Deletes the active tracker message for the current guild and removes it from `terrorized-store.json`.

## Notes

- Commands are currently registered globally (`Routes.applicationCommands`), so new/updated commands may take time to appear in Discord.
- Store format is an array of tracked messages keyed by message metadata (`guildId`, `channelId`, `messageId`) plus current/next zone data.

## Project Scripts

- `npm run build` -> TypeScript compile to `dist/`
- `npm start` -> build + run `dist/bot.js`
- `npm run dev` -> run `dist/bot.js` in watch mode

## Deploy with Docker Compose

1. Create a new directory on your machine and `cd` to it
2. Create a new file named `docker-compose.yml` and copy the contents to it
3. Create a `.env` file with the required Environment Variables in the same directory as the `docker-compose.yml` and populate it with the proper variables as instructed above
4. Run `docker compose up -d && docker compose logs -f`
