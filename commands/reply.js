const { SlashCommandBuilder } = require('discord.js');
const { handleReplyCommand } = require('../handlers/threadHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('reply anonymously in your approved thread')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('what you want to say')
        .setRequired(true)
        .setMaxLength(1500),
    ),

  async execute(interaction) {
    await handleReplyCommand(interaction);
  },
};
