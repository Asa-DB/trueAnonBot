const { SlashCommandBuilder } = require('discord.js');
const { getSubmissionByThreadId } = require('../handlers/submissionHandler');

function buildReplyHelp(interaction) {
  if (!interaction.channel || !interaction.channel.isThread()) {
    return [
      'reply by DMing the bot, not by posting in the server.',
      'this keeps things mostly anonymous in normal server use.',
      'once your vent is approved, send me a DM and i will post it as an anonymous follow-up.',
      'if you have more than one open vent, start the DM with the submission id like `ABC123: more context here`.',
      'discord itself and whoever runs the bot are still technical limits, because that is how discord bots fundamentally work.',
    ].join('\n');
  }

  const submission = getSubmissionByThreadId(interaction.channel.id);

  if (!submission) {
    return [
      'reply by DMing the bot, not by posting in the server.',
      'this keeps things mostly anonymous in normal server use.',
      'if this thread belongs to one of your approved vents, send me a DM and i will post it as an anonymous follow-up.',
      'if you have more than one open vent, start the DM with the submission id like `ABC123: more context here`.',
      'discord itself and whoever runs the bot are still technical limits, because that is how discord bots fundamentally work.',
    ].join('\n');
  }

  return [
    'reply by DMing the bot, not by posting in the server.',
    'this keeps things mostly anonymous in normal server use.',
    `for this thread, use submission id \`${submission.submissionId}\` if you need it.`,
    'example: `'
      + `${submission.submissionId}: more context here`
      + '`',
    'if this is your only open vent, you can also just DM the message normally.',
    'discord itself and whoever runs the bot are still technical limits, because that is how discord bots fundamentally work.',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('show how anonymous follow-ups work'),

  async execute(interaction) {
    await interaction.reply({
      content: buildReplyHelp(interaction),
      ephemeral: true,
    });
  },
};
