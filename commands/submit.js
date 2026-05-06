const { SlashCommandBuilder } = require('discord.js');
const { openSubmitModal } = require('../handlers/submissionHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('send an anonymous submission to the mod queue'),

  async execute(interaction) {
    await openSubmitModal(interaction);
  },
};
