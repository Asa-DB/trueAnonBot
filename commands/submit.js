const { InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { openSubmitModal } = require('../handlers/submissionHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('send an anonymous vent for mod review')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),

  async execute(interaction) {
    await openSubmitModal(interaction);
  },
};
