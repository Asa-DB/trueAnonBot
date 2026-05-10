const { InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { untossMember } = require('../handlers/tossHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untoss')
    .setDescription('restore a tossed member and close out their private room')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => (
      option
        .setName('member')
        .setDescription('member to restore')
        .setRequired(true)
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

    await untossMember(interaction, member);
  },
};
