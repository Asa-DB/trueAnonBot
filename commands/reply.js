const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { infoBox } = require('../utils/responseEmbeds');

function makeReplyCard() {
  return infoBox('Reply Help', [
    'reply by DMing the bot, not by posting in the server.',
    'when a vent is approved, the bot DMs you a control message for that vent.',
    'use the `Send Follow-Up` button on that DM to post more context anonymously.',
    'if a moderator asks for more info first, just reply to the bot DM normally.',
    'you can also use `/submit` in bot DMs if that is easier.',
    '',
    'I-it is not like I wanted to write a guide for you, but Discord and the bot host are still technical limits.',
  ]);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('show how anonymous follow-ups work')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),

  async execute(interaction) {
    await interaction.reply({
      embeds: [makeReplyCard()],
      ephemeral: true,
    });
  },
};
