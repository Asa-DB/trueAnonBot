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
const confirmQueue = new Map();
const livePosts = new Map();

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
        value: 'mods and the public do not see the sender from this post. the bot can still DM the sender for follow-up.',
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
  return item;
}

function removeLiveSubmission(submissionId) {
  livePosts.delete(submissionId);
}

function removeSubmissionByThreadId(threadId) {
  const item = getSubmissionByThreadId(threadId);

  if (!item) {
    return null;
  }

  livePosts.delete(item.submissionId);
  return item;
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
        '- moderators and the public will not see your username from the vent',
        '- the bot still knows your account so it can DM you if mods ask for more info',
        '- this does not hide you from discord or from whoever runs the bot',
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

  confirmQueue.set(data.submissionId, {
    ...data,
    dmUserId: interaction.user.id,
  });

  await interaction.reply({
    content: 'check your dms first. that message also explains exactly what stays anonymous and what does not.',
    ephemeral: true,
  });
}

async function handleSubmitConfirmButton(interaction) {
  const [, action, submissionId] = interaction.customId.split(':');
  const data = confirmQueue.get(submissionId);

  if (!data || data.dmUserId !== interaction.user.id) {
    await interaction.reply({
      content: 'that submit prompt is dead now',
      ephemeral: true,
    });
    return;
  }

  confirmQueue.delete(submissionId);

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

  livePosts.set(data.submissionId, {
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
