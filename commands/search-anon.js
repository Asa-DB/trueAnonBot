const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { handleSearchAnonCommand } = require('../handlers/threadHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search-anon')
    .setDescription('find submissions from one anonymous identity')
    .addStringOption((option) =>
      option
        .setName('anon-id')
        .setDescription('anon id like anon-1234')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),

  async execute(interaction) {
    await handleSearchAnonCommand(interaction);
  },
};
