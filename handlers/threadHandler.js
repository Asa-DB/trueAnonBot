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
  getSubmissionByThreadId,
  patchLiveSubmission,
  removeLiveSubmission,
  removeSubmissionByThreadId,
} = require('./submissionHandler');
const threadLastActive = {};
const infoRequests = new Map();
const DEAD_MS = 8 * 60 * 60 * 1000;
const MANAGED_PREFIX = 'anon post ';

function canModerate(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
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
      content: 'forum channel is not configured',
      ephemeral: true,
    });
    return;
  }

  const forumChannel = await interaction.client.channels.fetch(forumChannelId);

  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: 'forum channel is missing or not a forum',
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

  // just drop a message so people behave lol
  await thread.send({
    content: 'This vent was posted anonymously. The public and the thread do not show who sent it. Moderators can ask follow-up questions through the bot without exposing the sender.',
  });

  await thread.send({
    content: 'mods can close this if the thread is done',
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
    content: `approved and posted in <#${thread.id}>`,
    ephemeral: true,
  });

  const sender = await interaction.client.users.fetch(submission.userId).catch(() => null);

  if (sender) {
    await sender.send([
      'your vent was approved and posted.',
      'the post is still anonymous to the public and moderators.',
      'if a moderator needs more information, the bot may DM you and relay your reply without showing your username.',
      `thread: <#${thread.id}>`,
    ].join('\n')).catch(() => null);
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
  let dmWorked = false;

  if (sender) {
    dmWorked = await sender.send([
      'your vent was rejected by a moderator.',
      cleanReason ? `reason:\n${cleanReason}` : 'no reason was included.',
      '',
      'the moderator still does not get your username from the vent through the bot.',
    ].join('\n')).then(() => true).catch(() => false);
  }

  removeLiveSubmission(submission.submissionId);

  await interaction.reply({
    content: dmWorked
      ? 'submission rejected'
      : 'submission rejected. i could not DM the sender, but their identity was not exposed.',
    ephemeral: true,
  });
}

async function handleReviewButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  const [, action, submissionId] = interaction.customId.split(':');
  const submission = getLiveSubmission(submissionId);

  if (!submission) {
    await interaction.reply({
      content: 'that submission is gone. if the bot restarted, pending reviews do not survive it now.',
      ephemeral: true,
    });
    return;
  }

  if (submission.status !== 'pending') {
    await interaction.reply({
      content: `this one is already ${submission.status}`,
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
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  const submissionId = interaction.customId.split(':')[3];
  const submission = getLiveSubmission(submissionId);

  if (!submission) {
    await interaction.reply({
      content: 'that submission is gone. if the bot restarted, pending reviews do not survive it now.',
      ephemeral: true,
    });
    return;
  }

  if (submission.status !== 'pending') {
    await interaction.reply({
      content: `this one is already ${submission.status}`,
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
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      content: 'this button only works in a thread',
      ephemeral: true,
    });
    return;
  }

  await interaction.update({
    content: `thread closed by <@${interaction.user.id}>`,
    components: [],
  });

  clearInfoRequestForThread(interaction.channel.id);
  delete threadLastActive[interaction.channel.id];
  removeSubmissionByThreadId(interaction.channel.id);
  await interaction.channel.setLocked(true, `closed by ${interaction.user.tag}`);
  await interaction.channel.setArchived(true, `closed by ${interaction.user.tag}`);
}

async function handleResolvedButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      content: 'this button only works in a thread',
      ephemeral: true,
    });
    return;
  }

  // mods said its done so just lock it
  await interaction.update({
    content: `thread resolved by <@${interaction.user.id}>`,
    components: [],
  });

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
}

async function handleRequestMoreInfoButton(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      content: 'this button only works in a thread',
      ephemeral: true,
    });
    return;
  }

  const submission = getSubmissionByThreadId(interaction.channel.id);

  if (!submission) {
    await interaction.reply({
      content: 'i do not have the sender link for this vent anymore. if the bot restarted, follow-up DMs stop working for older vents.',
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
      content: 'you need Manage Threads for this',
      ephemeral: true,
    });
    return;
  }

  const threadId = interaction.customId.split(':')[3];
  const submission = getSubmissionByThreadId(threadId);

  if (!submission) {
    await interaction.reply({
      content: 'i do not have the sender link for this vent anymore.',
      ephemeral: true,
    });
    return;
  }

  if (infoRequests.has(submission.userId)) {
    await interaction.reply({
      content: 'there is already a follow-up question waiting on this sender.',
      ephemeral: true,
    });
    return;
  }

  const question = interaction.fields.getTextInputValue('moreinfo-question').trim();
  const sender = await interaction.client.users.fetch(submission.userId).catch(() => null);

  if (!sender) {
    await interaction.reply({
      content: 'i could not find the sender account anymore',
      ephemeral: true,
    });
    return;
  }

  const dmWorked = await sender.send([
    'a moderator asked for more information about your anonymous vent.',
    '',
    'what they asked:',
    question,
    '',
    'reply in this DM and i will forward your answer without showing your username.',
    'the vent stays anonymous to the public and to moderators in normal bot use.',
  ].join('\n')).then(() => true).catch(() => false);

  if (!dmWorked) {
    await interaction.reply({
      content: 'i could not DM the sender',
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

  await interaction.reply({
    content: 'question sent in DM. their username is not shown in the thread or in the relay.',
    ephemeral: true,
  });
}

async function handleMoreInfoDmReply(message) {
  if (message.author.bot || message.guildId) {
    return;
  }

  const pending = infoRequests.get(message.author.id);

  if (!pending) {
    return;
  }

  const text = message.content.trim();

  if (!text) {
    await message.channel.send('send some text and i will pass it back anonymously');
    return;
  }

  const modUser = await message.client.users.fetch(pending.moderatorId).catch(() => null);

  if (!modUser) {
    await message.channel.send('i could not find the moderator who asked');
    return;
  }

  const sent = await modUser.send([
    `reply to your anonymous vent follow-up for submission ${pending.submissionId}`,
    `thread: <#${pending.threadId}>`,
    '',
    'your question:',
    pending.question,
    '',
    'their reply:',
    text,
  ].join('\n')).then(() => true).catch(() => false);

  if (!sent) {
    await message.channel.send('i could not DM the moderator who asked. ask them to enable DMs and try again.');
    return;
  }

  infoRequests.delete(message.author.id);
  await message.channel.send('sent back through the bot without showing your username');
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
  handleMoreInfoDmReply,
  handleRejectModal,
  handleResolvedButton,
  handleCloseButton,
  handleRequestMoreInfoButton,
  handleRequestMoreInfoModal,
  handleReviewButton,
  noteThreadStuff,
  startDeadThreadLoop,
};
