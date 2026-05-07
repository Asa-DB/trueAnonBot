const { handleSubmitModal, handleSubmitConfirmButton } = require('../handlers/submissionHandler');
const {
  handleCloseButton,
  handleRejectModal,
  handleRequestMoreInfoButton,
  handleRequestMoreInfoModal,
  handleResolvedButton,
  handleReviewButton,
} = require('../handlers/threadHandler');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
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
      }
    } catch (error) {
      console.error('interaction failed');
      console.error(error);

      const reply = {
        content: 'something broke on my side',
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
