const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { makeAnonId, makeSubmissionId } = require('../utils/idGenerator');
const storage = require('../utils/storage');
const waitingStuff = new Map();

function buildReviewEmbed(submission) {
  return new EmbedBuilder()
    .setTitle('new anonymous submission')
    .setColor(0x2b2d31)
    .setDescription(submission.content)
    .addFields(
      { name: 'submission id', value: submission.submissionId, inline: true },
      { name: 'anon id', value: submission.anonId, inline: true },
      { name: 'status', value: submission.status, inline: true },
    )
    .setTimestamp(new Date(submission.createdAt));
}

function buildReviewButtons(submissionId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`submission:approve:${submissionId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`submission:reject:${submissionId}`)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function getOrCreateUserAnonId(guildId, userId) {
  const currentAnonId = storage.getUserAnonId(guildId, userId);

  if (currentAnonId) {
    return currentAnonId;
  }

  let anonId = null;

  // quick lookup nothing fancy
  do {
    anonId = makeAnonId();
  } while (storage.anonIdExistsInGuild(guildId, anonId));

  storage.saveUserAnonId(guildId, userId, anonId);
  return anonId;
}

async function openSubmitModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('submit-modal')
    .setTitle('anonymous submission');

  const messageInput = new TextInputBuilder()
    .setCustomId('submission-content')
    .setLabel('what do you want to post')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1500)
    .setRequired(true)
    .setPlaceholder('write whatever you need to say');

  const row = new ActionRowBuilder().addComponents(messageInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleSubmitModal(interaction) {
  const modQueueChannelId = interaction.client.botConfig.modQueueChannelId;

  if (!modQueueChannelId) {
    await interaction.reply({
      content: 'mod queue channel is not configured',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: 'this only works inside a server',
      ephemeral: true,
    });
    return;
  }

  const data = {
    submissionId: makeSubmissionId(),
    guildId: interaction.guildId,
    anonId: getOrCreateUserAnonId(interaction.guildId, interaction.user.id),
    userId: interaction.user.id,
    content: interaction.fields.getTextInputValue('submission-content').trim(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    reviewChannelId: null,
    reviewMessageId: null,
    threadId: null,
    approvedAt: null,
    rejectedAt: null,
    closedAt: null,
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`submit:confirm:${data.submissionId}`)
      .setLabel('yeah send it')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`submit:cancel:${data.submissionId}`)
      .setLabel('nah cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  try {
    // ask if they actually want this sent
    await interaction.user.send({
      content: `hey just checking, send this to mods?\n\nanon id: \`${data.anonId}\`\n\n${data.content}`,
      components: [row],
    });
  } catch (error) {
    // if no dm just give up lol
    await interaction.reply({
      content: 'cant dm you, enable dms or try again',
      ephemeral: true,
    });
    return;
  }

  waitingStuff.set(data.submissionId, data);

  await interaction.reply({
    content: 'check your dms first',
    ephemeral: true,
  });
}

async function handleSubmitConfirmButton(interaction) {
  const [, action, submissionId] = interaction.customId.split(':');
  const data = waitingStuff.get(submissionId);

  if (!data || data.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'that submit prompt is dead now',
      ephemeral: true,
    });
    return;
  }

  waitingStuff.delete(submissionId);

  if (action === 'cancel') {
    await interaction.update({
      content: 'cool, not sending it',
      components: [],
    });
    return;
  }

  const msg = await interaction.client.channels.fetch(interaction.client.botConfig.modQueueChannelId);

  if (!msg || !msg.isTextBased()) {
    await interaction.update({
      content: 'could not reach the mod queue so i gave up',
      components: [],
    });
    return;
  }

  const reviewMessage = await msg.send({
    embeds: [buildReviewEmbed(data)],
    components: [buildReviewButtons(data.submissionId)],
  });

  storage.addSubmission({
    ...data,
    reviewChannelId: reviewMessage.channelId,
    reviewMessageId: reviewMessage.id,
  });

  await interaction.update({
    content: `sent to mods\nanon id: \`${data.anonId}\``,
    components: [],
  });
}

module.exports = {
  buildReviewButtons,
  buildReviewEmbed,
  getOrCreateUserAnonId,
  handleSubmitConfirmButton,
  handleSubmitModal,
  openSubmitModal,
};
