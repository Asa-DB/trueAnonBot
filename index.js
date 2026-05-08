require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} = require('discord.js');

function splitIds(raw) {
  return (raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStickyMinutes(raw) {
  const num = Number(raw);

  if (!Number.isFinite(num) || num <= 0) {
    return 10;
  }

  return num;
}

function readMessage(raw) {
  return (raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();
client.botConfig = {
  guildId: process.env.GUILD_ID,
  submitChannelIds: splitIds(process.env.VENT_COMMAND_CHANNEL_IDS || process.env.SUBMIT_CHANNEL_IDS),
  modQueueChannelId: process.env.VENT_REVIEW_CHANNEL_ID || process.env.MOD_QUEUE_CHANNEL_ID,
  forumChannelId: process.env.VENT_FORUM_CHANNEL_ID || process.env.FORUM_CHANNEL_ID,
  stickyChannelId: process.env.STICKY_CHANNEL_ID || '',
  stickyMessage: readMessage(process.env.STICKY_MESSAGE),
  stickyIntervalMs: readStickyMinutes(process.env.STICKY_INTERVAL_MINUTES) * 60 * 1000,
  modRoleId: process.env.MODROLE || '',
};

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
    continue;
  }

  client.on(event.name, (...args) => event.execute(...args));
}

if (!process.env.DISCORD_TOKEN) {
  console.error('missing DISCORD_TOKEN in .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
