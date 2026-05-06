require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const requiredVars = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingVars = requiredVars.filter((name) => !process.env[name]);

if (missingVars.length) {
  console.error(`missing env vars: ${missingVars.join(', ')}`);
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );

  console.log(`deployed ${commands.length} slash commands`);
}

deployCommands().catch((error) => {
  console.error('failed to deploy commands');
  console.error(error);
  process.exit(1);
});
