const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} = require('discord.js');

const {
  buildReviewButtons,
  buildReviewEmbed,
  getLiveSubmission,
  isApprovedSubmissionOwner,
  getSubmissionByThreadId,
  patchLiveSubmission,
  removeLiveSubmission,
  removeSubmissionByThreadId,
} = require('./submissionHandler');
const {
  errEmbed,
  infoBox,
  okEmbed,
  warnBox,
} = require('../utils/responseEmbeds');
const runtimeStore = require('../utils/runtimeStore');
const threadLastActive = {};
const savedState = runtimeStore.readState();
const infoRequests = new Map(savedState.infoRequests.map((item) => [
  item.userId,
  {
    threadId: item.threadId,
    moderatorId: item.moderatorId,
    question: item.question,
    submissionId: item.submissionId,
  },
]));
const DEAD_MS = 8 * 60 * 60 * 1000;
const MANAGED_PREFIX = 'anon post ';
const FOLLOW_UP_LIMIT = 1500;

function saveInfoRequests() {
  runtimeStore.saveInfoRequestState(infoRequests);
}

function hasModRole(interaction, modRoleId) {
  const roles = interaction.member?.roles;

  if (!roles || !modRoleId) {
    return false;
  }

  if (Array.isArray(roles)) {
    return roles.includes(modRoleId);
  }

  return roles.cache?.has(modRoleId) || false;
}

function canModerate(interaction) {
  const modRoleId = interaction.client.botConfig.modRoleId;

  if (modRoleId) {
    return hasModRole(interaction, modRoleId);
  }

  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads) || false;
}

function getModDeniedMessage(interaction) {
  if (interaction.client.botConfig.modRoleId) {
    return 'You need the configured mod role for that.';
  }

  return 'You need `Manage Threads` for that.';
}

async function updateReviewMessage(interaction, submission, extraText) {
  const updatedSubmission = getLiveSubmission(submission.submissionId) || submission;
  let targetMessage = interaction.message || null;

  if (!targetMessage && submission.reviewChannelId && submission.reviewMessageId) {
    const reviewChannel = await interaction.client.channels.fetch(submission.reviewChannelId).catch(() => null);

    if (reviewChannel && reviewChannel.isTextBased()) {
      targetMessage = await reviewChannel.messages.fetch(submission.reviewMessageId).catch(() => null);
    }
  }

  if (!targetMessage) {
    return;
  }

  await targetMessage.edit({
    content: extraText,
    embeds: [buildReviewEmbed(updatedSubmission)],
    components: [buildReviewButtons(updatedSubmission.submissionId, true)],
  });
}

async function approveSubmission(interaction, submission) {
  const forumChannelId = interaction.client.botConfig.forumChannelId;

  if (!forumChannelId) {
    await interaction.reply({
      embeds: [errEmbed('Setup Problem', 'The forum channel is not configured.')],
      ephemeral: true,
    });
    return;
  }

  const forumChannel = await interaction.client.channels.fetch(forumChannelId);

  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      embeds: [errEmbed('Setup Problem', 'The forum channel is missing or is not a forum channel.')],
      ephemeral: true,
    });
    return;
  }

  const thread = await forumChannel.threads.create({
    name: `${MANAGED_PREFIX}${submission.submissionId.toLowerCase()}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    message: {
      content: `**anonymous post**\n${submission.content}`,
    },
    reason: `approved anonymous submission ${submission.submissionId}`,
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('thread:moreinfo')
      .setLabel('Request More Info')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('thread:resolved')
      .setLabel('Resolved')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('thread:close')
      .setLabel('Close Thread')
      .setStyle(ButtonStyle.Secondary),
  );

  await thread.send({
    embeds: [infoBox('Thread Notice', [
      'This vent is mostly anonymous in normal server use.',
      'The public thread does not show who sent it.',
      'Moderators can ask follow-up questions through the bot without exposing the sender in the thread.',
      '',
      'Discord and the bot host are still technical limits, so do not get any strange ideas.',
    ])],
  });

  await thread.send({
    embeds: [infoBox('Thread Controls', [
      'Use `Resolved` when the issue is handled.',
      'Use `Close Thread` when the thread just needs to be shut down.',
    ])],
    components: [closeRow],
  });

  threadLastActive[thread.id] = Date.now();

  patchLiveSubmission(submission.submissionId, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: interaction.user.id,
    threadId: thread.id,
  });

  await updateReviewMessage(
    interaction,
    submission,
    `approved by <@${interaction.user.id}> | thread: <#${thread.id}>`,
  );

  await interaction.reply({
    embeds: [okEmbed('Approved', [
      `Posted in <#${thread.id}>.`,
      'Clean work. Try not to look so smug about it.',
    ])],
    ephemeral: true,
  });

  const sender = await interaction.client.users.fetch(submission.userId).catch(() => null);

  if (sender) {
    const replyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vent:reply:${submission.submissionId}`)
        .setLabel('Send Follow-Up')
        .setStyle(ButtonStyle.Primary),
    );

    await sender.send({
      embeds: [okEmbed('Your Vent Is Live', [
        'Your vent was approved and posted.',
        'It stays mostly anonymous to the public and moderators in normal server use.',
        '',
        'Use the button below any time you want to send an anonymous follow-up to this thread.',
        '',
        'If a moderator needs more information, the bot may DM you and relay your reply without showing your username in the thread.',
        'Discord and the bot host are still technical limits.',
        '',
        'I-it is not like I made this control button just for you or anything.',
      ])],
      components: [replyRow],
    }).catch(() => null);
  }
}

async function rejectSubmission(interaction, submission, reasonText) {
  const cleanReason = reasonText.trim();

  patchLiveSubmission(submission.submissionId, {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedBy: interaction.user.id,
    rejectionReason: cleanReason || null,
  });

  await updateReviewMessage(
    interaction,
    submission,
    cleanReason
      ? `rejected by <@${interaction.user.id}> | reason sent`
      : `rejected by <@${interaction.user.id}>`,
  );

  const sender = await interaction.client.users.fetch(submission.userId).catch(() => null);
  let didDmWork = false;

  if (sender) {
    didDmWork = await sender.send({
      embeds: [warnBox('Vent Rejected', [
        'A moderator rejected your vent.',
        cleanReason ? `**Reason:**\n${cleanReason}` : 'No reason was included.',
        '',
        'Your username still was not shown through the normal bot flow.',
      ])],
    }).then(() => true).catch(() => false);
  }

  removeLiveSubmission(submission.submissionId);

  await interaction.reply({
    embeds: [didDmWork
      ? warnBox('Rejected', 'The submission was rejected.')
      : warnBox('Rejected', [
        'The submission was rejected.',
        'I could not DM the sender, but their identity was not exposed through the normal bot flow.',
      ])],
    ephemeral: true,
  });
}

async function handleReviewButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  const [, action, submissionId] = interaction.customId.split(':');
  const submission = getLiveSubmission(submissionId);

  if (!submission) {
    await interaction.reply({
      embeds: [warnBox('Submission Missing', [
        'That submission is gone.',
        'If the bot restarted, pending reviews may not have survived.',
      ])],
      ephemeral: true,
    });
    return;
  }

  if (submission.status !== 'pending') {
    await interaction.reply({
      embeds: [infoBox('Already Handled', `This one is already \`${submission.status}\`.`)],
      ephemeral: true,
    });
    return;
  }

  if (action === 'approve') {
    await approveSubmission(interaction, submission);
    return;
  }

  if (action === 'reject') {
    const modal = new ModalBuilder()
      .setCustomId(`submission:reject:modal:${submissionId}`)
      .setTitle('reject vent');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reject-reason')
      .setLabel('optional reason to DM back')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000)
      .setPlaceholder('type a reason if you want one sent back');

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }
}

async function handleRejectModal(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  const submissionId = interaction.customId.split(':')[3];
  const submission = getLiveSubmission(submissionId);

  if (!submission) {
    await interaction.reply({
      embeds: [warnBox('Submission Missing', [
        'That submission is gone.',
        'If the bot restarted, pending reviews may not have survived.',
      ])],
      ephemeral: true,
    });
    return;
  }

  if (submission.status !== 'pending') {
    await interaction.reply({
      embeds: [infoBox('Already Handled', `This one is already \`${submission.status}\`.`)],
      ephemeral: true,
    });
    return;
  }

  const why = interaction.fields.getTextInputValue('reject-reason');
  await rejectSubmission(interaction, submission, why);
}

async function handleCloseButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'That button only works inside a thread.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.update({
    embeds: [infoBox('Thread Closed', `Closed by <@${interaction.user.id}>.`)],
    content: '',
    components: [],
  });

  const submission = getSubmissionByThreadId(interaction.channel.id);

  if (submission) {
    patchLiveSubmission(submission.submissionId, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id,
    });
  }

  clearInfoRequestForThread(interaction.channel.id);
  delete threadLastActive[interaction.channel.id];
  removeSubmissionByThreadId(interaction.channel.id);
  await interaction.channel.setLocked(true, `closed by ${interaction.user.tag}`);
  await interaction.channel.setArchived(true, `closed by ${interaction.user.tag}`);
}

async function handleResolvedButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'That button only works inside a thread.')],
      ephemeral: true,
    });
    return;
  }

  // mods said its done so just lock it
  await interaction.update({
    embeds: [okEmbed('Thread Resolved', `Resolved by <@${interaction.user.id}>.`)],
    content: '',
    components: [],
  });

  const submission = getSubmissionByThreadId(interaction.channel.id);

  if (submission) {
    patchLiveSubmission(submission.submissionId, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: interaction.user.id,
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id,
    });
  }

  clearInfoRequestForThread(interaction.channel.id);
  delete threadLastActive[interaction.channel.id];
  removeSubmissionByThreadId(interaction.channel.id);
  await interaction.channel.setLocked(true, `resolved by ${interaction.user.tag}`);
  await interaction.channel.setArchived(true, `resolved by ${interaction.user.tag}`);
}

function isManagedAnonThread(thread) {
  return thread.name.toLowerCase().startsWith(MANAGED_PREFIX);
}

function clearInfoRequestForThread(threadId) {
  for (const [userId, request] of infoRequests.entries()) {
    if (request.threadId === threadId) {
      infoRequests.delete(userId);
    }
  }

  saveInfoRequests();
}

async function handleRequestMoreInfoButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'That button only works inside a thread.')],
      ephemeral: true,
    });
    return;
  }

  const submission = getSubmissionByThreadId(interaction.channel.id);

  if (!submission) {
    await interaction.reply({
      embeds: [warnBox('Sender Link Missing', [
        'I do not have the sender link for this vent anymore.',
        'If the bot restarted, follow-up DMs may not work for older vents.',
      ])],
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`thread:moreinfo:modal:${interaction.channel.id}`)
    .setTitle('request more info');

  const prompt = new TextInputBuilder()
    .setCustomId('moreinfo-question')
    .setLabel('what should the bot ask them')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('type the exact question for the sender');

  modal.addComponents(new ActionRowBuilder().addComponents(prompt));
  await interaction.showModal(modal);
}

async function handleRequestMoreInfoModal(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', getModDeniedMessage(interaction))],
      ephemeral: true,
    });
    return;
  }

  const threadId = interaction.customId.split(':')[3];
  const submission = getSubmissionByThreadId(threadId);

  if (!submission) {
    await interaction.reply({
      embeds: [warnBox('Sender Link Missing', 'I do not have the sender link for this vent anymore.')],
      ephemeral: true,
    });
    return;
  }

  if (infoRequests.has(submission.userId)) {
    await interaction.reply({
      embeds: [infoBox('Already Waiting', 'There is already a follow-up question waiting on this sender.')],
      ephemeral: true,
    });
    return;
  }

  const question = interaction.fields.getTextInputValue('moreinfo-question').trim();

  if (!question) {
    await interaction.reply({
      embeds: [warnBox('Question Needed', 'Type a question first.')],
      ephemeral: true,
    });
    return;
  }

  const sender = await interaction.client.users.fetch(submission.userId).catch(() => null);

  if (!sender) {
    await interaction.reply({
      embeds: [warnBox('Sender Missing', 'I could not find the sender account anymore.')],
      ephemeral: true,
    });
    return;
  }

  const dmOk = await sender.send({
    embeds: [infoBox('Moderator Follow-Up', [
      'A moderator asked for more information about your anonymous vent.',
      '',
      `**What they asked:**\n${question}`,
      '',
      'Reply in this DM and I will forward your answer without showing your username.',
      'The vent stays mostly anonymous to the public and to moderators in normal bot use.',
      'Discord and the bot host are still technical limits.',
    ])],
  }).then(() => true).catch(() => false);

  if (!dmOk) {
    await interaction.reply({
      embeds: [warnBox('DM Failed', 'I could not DM the sender.')],
      ephemeral: true,
    });
    return;
  }

  infoRequests.set(submission.userId, {
    threadId,
    moderatorId: interaction.user.id,
    question,
    submissionId: submission.submissionId,
  });
  saveInfoRequests();

  await interaction.reply({
    embeds: [okEmbed('Question Sent', [
      'The question was sent in DM.',
      'Their username is not shown in the thread or in the relay.',
    ])],
    ephemeral: true,
  });
}

function pullMessageBody(message) {
  const bits = [];
  const text = message.content.trim();

  if (text) {
    bits.push(text);
  }

  if (message.attachments.size) {
    bits.push(message.attachments.map((item) => item.url).join('\n'));
  }

  return bits.join('\n').trim();
}

async function relayMoreInfoReply(message, pending) {
  const text = pullMessageBody(message);

  if (!text) {
    await message.channel.send({
      embeds: [infoBox('Need Something To Relay', 'Send text, an attachment, or both and I will pass it back anonymously.')],
    });
    return;
  }

  const modUser = await message.client.users.fetch(pending.moderatorId).catch(() => null);

  if (!modUser) {
    await message.channel.send({
      embeds: [warnBox('Moderator Missing', 'I could not find the moderator who asked.')],
    });
    return;
  }

  const sentBack = await modUser.send({
    embeds: [infoBox('Anonymous Reply Received', [
      `Submission: \`${pending.submissionId}\``,
      `Thread: <#${pending.threadId}>`,
      '',
      `**Your question:**\n${pending.question}`,
      '',
      `**Their reply:**\n${text}`,
    ])],
  }).then(() => true).catch(() => false);

  if (!sentBack) {
    await message.channel.send({
      embeds: [warnBox('Relay Failed', 'I could not DM the moderator who asked. Ask them to enable DMs and try again.')],
    });
    return;
  }

  infoRequests.delete(message.author.id);
  saveInfoRequests();
  await message.channel.send({
    embeds: [okEmbed('Sent', [
      'Your reply was passed along without showing your username.',
      'There. Efficient enough for you?',
    ])],
  });
}

async function postAnonFollowup(message) {
  await message.channel.send({
    embeds: [infoBox('Use The Control Message', [
      'Follow-ups now go through the control message I DM when a vent is approved.',
      'Use the `Send Follow-Up` button on that DM so I know which thread to post to.',
      '',
      'Yes, this really is the cleaner way to do it.',
    ])],
  });
}

async function postAnonFollowupForSubmission(interaction, submissionId, body) {
  const submission = getLiveSubmission(submissionId);

  if (!submission || submission.status !== 'approved' || !submission.threadId) {
    await interaction.reply({
      embeds: [warnBox('Vent Closed', 'That vent is not open for follow-ups anymore.')],
      ephemeral: true,
    });
    return;
  }

  if (submission.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [warnBox('Not Yours', 'That control message is not for you.')],
      ephemeral: true,
    });
    return;
  }

  if (!body) {
    await interaction.reply({
      embeds: [warnBox('Need A Follow-Up', 'Type a follow-up first.')],
      ephemeral: true,
    });
    return;
  }

  if (body.length > FOLLOW_UP_LIMIT) {
    await interaction.reply({
      embeds: [warnBox('Too Long', `Keep follow-ups under ${FOLLOW_UP_LIMIT} characters.`)],
      ephemeral: true,
    });
    return;
  }

  const thread = await interaction.client.channels.fetch(submission.threadId).catch(() => null);

  if (!thread || !thread.isThread() || thread.archived || thread.locked) {
    removeSubmissionByThreadId(submission.threadId);
    await interaction.reply({
      embeds: [warnBox('Thread Closed', 'That vent thread is closed, so I did not post the follow-up.')],
      ephemeral: true,
    });
    return;
  }

  const sent = await thread.send({
    content: `**anonymous follow-up**\n${body}`,
  }).then(() => true).catch(() => false);

  if (!sent) {
    await interaction.reply({
      embeds: [errEmbed('Post Failed', 'Something broke while posting that follow-up.')],
      ephemeral: true,
    });
    return;
  }

  threadLastActive[thread.id] = Date.now();
  await interaction.reply({
    embeds: [okEmbed('Follow-Up Posted', [
      'Your anonymous follow-up was posted.',
      'Try to appreciate the efficiency quietly.',
    ])],
    ephemeral: true,
  });
}

async function handleVentReplyButton(interaction) {
  const submissionId = interaction.customId.split(':')[2];

  if (!isApprovedSubmissionOwner(submissionId, interaction.user.id)) {
    await interaction.reply({
      embeds: [warnBox('Control Message Expired', 'That control message is not active for you anymore.')],
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`vent:reply:modal:${submissionId}`)
    .setTitle('anonymous follow-up');

  const input = new TextInputBuilder()
    .setCustomId('followup-body')
    .setLabel('what do you want to add')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(FOLLOW_UP_LIMIT)
    .setPlaceholder('write your follow-up here');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleVentReplyModal(interaction) {
  const submissionId = interaction.customId.split(':')[3];

  if (!isApprovedSubmissionOwner(submissionId, interaction.user.id)) {
    await interaction.reply({
      embeds: [warnBox('Control Message Expired', 'That control message is not active for you anymore.')],
      ephemeral: true,
    });
    return;
  }

  const body = interaction.fields.getTextInputValue('followup-body').trim();
  await postAnonFollowupForSubmission(interaction, submissionId, body);
}

async function handleDirectMessage(message) {
  if (message.author.bot || message.guildId) {
    return;
  }

  const pending = infoRequests.get(message.author.id);

  if (pending) {
    await relayMoreInfoReply(message, pending);
    return;
  }

  await postAnonFollowup(message);
}

function noteThreadStuff(message) {
  if (!message.channel || !message.channel.isThread()) {
    return;
  }

  if (!isManagedAnonThread(message.channel)) {
    return;
  }

  threadLastActive[message.channel.id] = Date.now();
}

async function checkDeadThreads(client) {
  const forumId = client.botConfig.forumChannelId;
  const now = Date.now();

  if (!forumId) {
    return;
  }

  const forum = await client.channels.fetch(forumId).catch(() => null);

  if (!forum || forum.type !== ChannelType.GuildForum) {
    return;
  }

  const active = await forum.threads.fetchActive().catch(() => null);

  if (!active) {
    return;
  }

  for (const thread of active.threads.values()) {
    if (!isManagedAnonThread(thread)) {
      continue;
    }

    let last = threadLastActive[thread.id];

    if (!last && thread.lastMessageId) {
      const msg = await thread.messages.fetch(thread.lastMessageId).catch(() => null);

      if (msg) {
        last = msg.createdTimestamp;
      }
    }

    if (!last) {
      last = thread.createdTimestamp || now;
    }

    threadLastActive[thread.id] = last;

    if (now - last < DEAD_MS) {
      continue;
    }

    clearInfoRequestForThread(thread.id);
    await thread.setLocked(true, 'inactive for too long').catch(() => null);
    await thread.setArchived(true, 'inactive for too long').catch(() => null);
    delete threadLastActive[thread.id];
    removeSubmissionByThreadId(thread.id);
  }
}

function startDeadThreadLoop(client) {
  setInterval(() => {
    checkDeadThreads(client).catch((error) => {
      console.error('dead thread check failed');
      console.error(error);
    });
  }, 10 * 60 * 1000);
}

module.exports = {
  checkDeadThreads,
  handleDirectMessage,
  handleRejectModal,
  handleVentReplyButton,
  handleVentReplyModal,
  handleResolvedButton,
  handleCloseButton,
  handleRequestMoreInfoButton,
  handleRequestMoreInfoModal,
  handleReviewButton,
  noteThreadStuff,
  startDeadThreadLoop,
};
