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
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'this only works inside a server',
      ephemeral: true,
    });
    return;
  }

  const allowedChannels = interaction.client.botConfig.submitChannelIds || [];

  if (allowedChannels.length && !allowedChannels.includes(interaction.channelId)) {
    await interaction.reply({
      content: `you can only use \`/submit\` in ${formatChannelList(allowedChannels)}`,
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
      content: [
        'hey, before i send this:',
        '- your username stays hidden from the vent and from the normal mod review flow',
        '- if mods need more information later, i can DM you and relay your reply without putting your username in the thread',
        '- if your vent gets approved, you can DM me follow-ups and i will post them anonymously',
        '',
        'send this to mods?',
        '',
        data.content,
      ].join('\n'),
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

  savePendingSubmission({
    ...data,
    dmUserId: interaction.user.id,
  });

  await interaction.reply({
    content: 'check your dms first to confirm it',
    ephemeral: true,
  });
}

async function handleSubmitConfirmButton(interaction) {
  const [, action, submissionId] = interaction.customId.split(':');
  const current = confirmQueue.get(submissionId);

  if (!current || current.dmUserId !== interaction.user.id) {
    await interaction.reply({
      content: 'that submit prompt is dead now',
      ephemeral: true,
    });
    return;
  }

  const data = consumePendingSubmission(submissionId);

  if (action === 'cancel') {
    await interaction.update({
      content: 'cool, not sending it',
      components: [],
    });
    return;
  }

  const queue = await interaction.client.channels.fetch(interaction.client.botConfig.modQueueChannelId);

  if (!queue || !queue.isTextBased()) {
    await interaction.update({
      content: 'could not reach the mod queue so i gave up',
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
    content: 'sent to mods',
    components: [],
  });
}

module.exports = {
  buildReviewButtons,
  buildReviewEmbed,
  getApprovedSubmissionsByUserId,
  getLiveSubmission,
  getSubmissionByThreadId,
  handleSubmitConfirmButton,
  handleSubmitModal,
  openSubmitModal,
  patchLiveSubmission,
  removeLiveSubmission,
  removeSubmissionByThreadId,
};
