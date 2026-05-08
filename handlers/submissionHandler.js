const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { makeSubmissionId } = require('../utils/idGenerator');
const {
  errEmbed,
  infoBox,
  okEmbed,
  warnBox,
} = require('../utils/responseEmbeds');
const runtimeStore = require('../utils/runtimeStore');

const savedState = runtimeStore.readState();
const confirmQueue = new Map(savedState.confirmQueue.map((item) => [item.submissionId, item]));
const livePosts = new Map(savedState.livePosts.map((item) => [item.submissionId, item]));

function saveState() {
  runtimeStore.saveSubmissionState(confirmQueue, livePosts);
}

function buildReviewEmbed(submission) {
  return new EmbedBuilder()
    .setTitle('new anonymous submission')
    .setColor(0x2b2d31)
    .setDescription(submission.content)
    .addFields(
      { name: 'submission id', value: submission.submissionId, inline: true },
      { name: 'status', value: submission.status, inline: true },
      {
        name: 'how anonymous is this',
        value: 'mostly anonymous in normal server use. mods and the public do not see the sender here, but discord and the bot still have technical limits.',
      },
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

function getLiveSubmission(submissionId) {
  return livePosts.get(submissionId) || null;
}

function getSubmissionByThreadId(threadId) {
  for (const item of livePosts.values()) {
    if (item.threadId === threadId) {
      return item;
    }
  }

  return null;
}

function getApprovedSubmissionsByUserId(userId) {
  const hits = [];

  for (const item of livePosts.values()) {
    if (item.userId !== userId) {
      continue;
    }

    if (item.status !== 'approved' || !item.threadId) {
      continue;
    }

    hits.push(item);
  }

  return hits;
}

function isApprovedSubmissionOwner(submissionId, userId) {
  const item = livePosts.get(submissionId);

  if (!item) {
    return false;
  }

  return item.status === 'approved' && item.userId === userId && Boolean(item.threadId);
}

function patchLiveSubmission(submissionId, bits) {
  const item = livePosts.get(submissionId);

  if (!item) {
    return null;
  }

  Object.assign(item, bits);
  saveState();
  return item;
}

function removeLiveSubmission(submissionId) {
  livePosts.delete(submissionId);
  saveState();
}

function removeSubmissionByThreadId(threadId) {
  const item = getSubmissionByThreadId(threadId);

  if (!item) {
    return null;
  }

  livePosts.delete(item.submissionId);
  saveState();
  return item;
}

function savePendingSubmission(submission) {
  confirmQueue.set(submission.submissionId, submission);
  saveState();
}

function consumePendingSubmission(submissionId) {
  const item = confirmQueue.get(submissionId) || null;

  if (!item) {
    return null;
  }

  confirmQueue.delete(submissionId);
  saveState();
  return item;
}

function saveLiveSubmission(submission) {
  livePosts.set(submission.submissionId, submission);
  saveState();
}

function formatChannelList(ids) {
  return ids.map((id) => `<#${id}>`).join(', ');
}

async function openSubmitModal(interaction) {
  const allowedChannels = interaction.client.botConfig.submitChannelIds || [];

  if (interaction.guildId && allowedChannels.length && !allowedChannels.includes(interaction.channelId)) {
    await interaction.reply({
      embeds: [warnBox('Wrong Channel', [
        `You can only use \`/submit\` in ${formatChannelList(allowedChannels)}.`,
        '',
        'Try not to make me repeat myself, okay?',
      ])],
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('submit-modal')
    .setTitle('anonymous vent');

  const messageInput = new TextInputBuilder()
    .setCustomId('submission-content')
    .setLabel('what do you want to send')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1500)
    .setRequired(true)
    .setPlaceholder('write your vent here');

  const row = new ActionRowBuilder().addComponents(messageInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleSubmitModal(interaction) {
  const modQueueChannelId = interaction.client.botConfig.modQueueChannelId;
  const targetGuildId = interaction.guildId || interaction.client.botConfig.guildId;

  if (!modQueueChannelId) {
    await interaction.reply({
      embeds: [errEmbed('Setup Problem', 'The mod queue channel is not configured.')],
      ephemeral: true,
    });
    return;
  }

  if (!targetGuildId) {
    await interaction.reply({
      embeds: [errEmbed('Setup Problem', 'The target guild is not configured.')],
      ephemeral: true,
    });
    return;
  }

  const data = {
    submissionId: makeSubmissionId(),
    guildId: targetGuildId,
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

  const yesNoRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`submit:confirm:${data.submissionId}`)
      .setLabel('Send It')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`submit:cancel:${data.submissionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  try {
    await interaction.user.send({
      embeds: [infoBox('Before I Send This', [
        'Your username stays hidden from the vent and from the normal mod review flow.',
        'If mods need more information later, I can DM you and relay your reply without putting your username in the thread.',
        'If your vent gets approved, I will DM you a control message for anonymous follow-ups.',
        '',
        '**Ready to send this to the mods?**',
        '',
        data.content,
        '',
        'I-it is your call. I am just making the process less painful.',
      ])],
      components: [yesNoRow],
    });
  } catch (error) {
    await interaction.reply({
      embeds: [errEmbed('DMs Closed', [
        'I could not DM you.',
        'Enable DMs for this server or message the bot directly, then try again.',
      ])],
      ephemeral: true,
    });
    return;
  }

  savePendingSubmission({
    ...data,
    dmUserId: interaction.user.id,
  });

  await interaction.reply({
    embeds: [okEmbed('Check Your DMs', [
      'I sent you a confirmation message.',
      'Open it and press `Send It` if you want the vent forwarded.',
    ])],
    ephemeral: true,
  });
}

async function handleSubmitConfirmButton(interaction) {
  const [, action, submissionId] = interaction.customId.split(':');
  const current = confirmQueue.get(submissionId);

  if (!current || current.dmUserId !== interaction.user.id) {
    await interaction.reply({
      embeds: [warnBox('Prompt Expired', [
        'That submit prompt is not active anymore.',
        'Run `/submit` again if you still want to send something.',
      ])],
      ephemeral: true,
    });
    return;
  }

  const data = consumePendingSubmission(submissionId);

  if (action === 'cancel') {
    await interaction.update({
      embeds: [infoBox('Not Sent', [
        'Fine. I did not send it.',
        'It is not like I was in a hurry anyway.',
      ])],
      content: '',
      components: [],
    });
    return;
  }

  const queue = await interaction.client.channels.fetch(interaction.client.botConfig.modQueueChannelId);

  if (!queue || !queue.isTextBased()) {
    await interaction.update({
      embeds: [errEmbed('Queue Unavailable', 'I could not reach the mod queue, so the vent was not sent.')],
      content: '',
      components: [],
    });
    return;
  }

  const reviewMessage = await queue.send({
    embeds: [buildReviewEmbed(data)],
    components: [buildReviewButtons(data.submissionId)],
  });

  saveLiveSubmission({
    ...data,
    reviewChannelId: reviewMessage.channelId,
    reviewMessageId: reviewMessage.id,
  });

  await interaction.update({
    embeds: [okEmbed('Sent To Mods', [
      'Your vent is in the review queue now.',
      'There. Nicely done.',
    ])],
    content: '',
    components: [],
  });
}

module.exports = {
  buildReviewButtons,
  buildReviewEmbed,
  getApprovedSubmissionsByUserId,
  isApprovedSubmissionOwner,
  getLiveSubmission,
  getSubmissionByThreadId,
  handleSubmitConfirmButton,
  handleSubmitModal,
  openSubmitModal,
  patchLiveSubmission,
  removeLiveSubmission,
  removeSubmissionByThreadId,
};
