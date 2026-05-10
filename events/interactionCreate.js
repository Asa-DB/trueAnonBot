const { handleSubmitModal, handleSubmitConfirmButton } = require('../handlers/submissionHandler');
const { handleTossButton } = require('../handlers/tossHandler');
const { errEmbed, warnBox } = require('../utils/responseEmbeds');
const {
  handleCloseButton,
  handleRejectModal,
  handleRequestMoreInfoButton,
  handleRequestMoreInfoModal,
  handleResolvedButton,
  handleVentCloseButton,
  handleVentDeleteButton,
  handleReviewButton,
  handleVentResolvedButton,
  handleVentReplyButton,
  handleVentReplyModal,
} = require('../handlers/threadHandler');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
          await interaction.reply({
            embeds: [warnBox('Command Missing', [
              'That command is not available on this bot anymore.',
              'Run `npm run deploy` to refresh the slash commands.',
            ])],
            ephemeral: true,
          }).catch(() => null);
          return;
        }

        await command.execute(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'submit-modal') {
          await handleSubmitModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('submission:reject:modal:')) {
          await handleRejectModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('thread:moreinfo:modal:')) {
          await handleRequestMoreInfoModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('vent:reply:modal:')) {
          await handleVentReplyModal(interaction);
          return;
        }

        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId.startsWith('submit:confirm:') || interaction.customId.startsWith('submit:cancel:')) {
          await handleSubmitConfirmButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('submission:')) {
          await handleReviewButton(interaction);
          return;
        }

        if (interaction.customId === 'thread:close') {
          await handleCloseButton(interaction);
          return;
        }

        if (interaction.customId === 'thread:resolved') {
          await handleResolvedButton(interaction);
          return;
        }

        if (interaction.customId === 'thread:moreinfo') {
          await handleRequestMoreInfoButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('vent:reply:')) {
          await handleVentReplyButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('vent:close:')) {
          await handleVentCloseButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('vent:resolved:')) {
          await handleVentResolvedButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('vent:delete:')) {
          await handleVentDeleteButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('toss:')) {
          await handleTossButton(interaction);
        }
      }
    } catch (error) {
      console.error('interaction failed');
      console.error(error);

      const reply = {
        embeds: [errEmbed('Something Broke', 'Something broke on my side. Try again in a bit.')],
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply).catch(() => null);
        return;
      }

      await interaction.reply(reply).catch(() => null);
    }
  },
};
