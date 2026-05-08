const { SlashCommandBuilder, InteractionContextType } = require('discord.js');

function buildReplyHelp() {
  return [
    'reply by DMing the bot, not by posting in the server.',
    'when a vent is approved, the bot DMs you a control message for that vent.',
    'use the `Send Follow-Up` button on that DM to post more context anonymously.',
    'if a moderator asks for more info first, just reply to the bot DM normally.',
    'you can also use `/submit` in bot DMs if that is easier.',
    'discord itself and whoever runs the bot are still technical limits, because that is how discord bots fundamentally work.',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('show how anonymous follow-ups work')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),

  async execute(interaction) {
    await interaction.reply({
      content: buildReplyHelp(),
      ephemeral: true,
    });
  },
};
