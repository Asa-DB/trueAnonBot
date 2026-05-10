const { InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { openTossRoom } = require('../handlers/tossHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toss')
    .setDescription('open a private staff room for a member and temporarily restrict their normal server access')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => (
      option
        .setName('member')
        .setDescription('member to move into a private support room')
        .setRequired(true)
    ))
    .addStringOption((option) => (
      option
        .setName('reason')
        .setDescription('optional reason shown in the room opener')
        .setMaxLength(400)
    )),

  async execute(interaction) {
    const user = interaction.options.getUser('member', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        content: 'I could not find that member in the server.',
        ephemeral: true,
      });
      return;
    }

    const why = interaction.options.getString('reason')?.trim() || '';
    await openTossRoom(interaction, member, why);
  },
};
