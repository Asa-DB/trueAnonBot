const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} = require('discord.js');

const storage = require('../utils/storage');
const { buildReviewButtons, buildReviewEmbed } = require('./submissionHandler');
const waitingReplies = {};
const threadLastActive = {};
const DEAD_MS = 8 * 60 * 60 * 1000;

function canModerate(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
}

async function updateReviewMessage(interaction, submission, extraText) {
  const updatedSubmission = storage.getSubmissionById(submission.submissionId);

  await interaction.message.edit({
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
    name: `anon case #${submission.anonId.slice(-4)}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    message: {
      content: `**anon post**\n${submission.content}`,
    },
    reason: `approved anonymous submission ${submission.anonId}`,
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
    content: 'This post was submitted anonymously. Please be respectful and helpful.',
  });

  await thread.send({
    content: 'mods can close this if the thread is done',
    components: [closeRow],
  });

  threadLastActive[thread.id] = Date.now();

  storage.updateSubmission(submission.submissionId, {
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
}

async function rejectSubmission(interaction, submission) {
  storage.updateSubmission(submission.submissionId, {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedBy: interaction.user.id,
  });

  await updateReviewMessage(
    interaction,
    submission,
    `rejected by <@${interaction.user.id}>`,
  );

  await interaction.reply({
    content: 'submission rejected',
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
  const submission = storage.getSubmissionById(submissionId);

  if (!submission) {
    await interaction.reply({
      content: 'that submission is gone somehow',
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
    await rejectSubmission(interaction, submission);
  }
}

async function handleReplyCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'this only works inside a server',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isThread()) {
    await interaction.reply({
      content: 'use this inside an approved thread',
      ephemeral: true,
    });
    return;
  }

  const submission = storage.getSubmissionByThreadId(interaction.channel.id);

  if (!submission) {
    await interaction.reply({
      content: 'this thread is not linked to an anonymous submission',
      ephemeral: true,
    });
    return;
  }

  if (submission.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'only the original submitter can use this here',
      ephemeral: true,
    });
    return;
  }

  const message = interaction.options.getString('message', true).trim();

  await interaction.channel.send({
    content: `**anon follow-up**\n${message}`,
  });

  await interaction.reply({
    content: 'posted anonymously',
    ephemeral: true,
  });
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

  const submission = storage.getSubmissionByThreadId(interaction.channel.id);

  if (submission) {
    storage.updateSubmission(submission.submissionId, {
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id,
    });
  }

  await interaction.update({
    content: `thread closed by <@${interaction.user.id}>`,
    components: [],
  });

  delete threadLastActive[interaction.channel.id];
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

  const submission = storage.getSubmissionByThreadId(interaction.channel.id);

  if (submission) {
    storage.updateSubmission(submission.submissionId, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: interaction.user.id,
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id,
    });
  }

  // mods said its done so just lock it
  await interaction.update({
    content: `thread resolved by <@${interaction.user.id}>`,
    components: [],
  });

  delete threadLastActive[interaction.channel.id];
  await interaction.channel.setLocked(true, `resolved by ${interaction.user.tag}`);
  await interaction.channel.setArchived(true, `resolved by ${interaction.user.tag}`);
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

  const submission = storage.getSubmissionByThreadId(interaction.channel.id);

  if (!submission) {
    await interaction.reply({
      content: 'this thread is not linked to an anonymous submission',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`thread:moreinfo:modal:${interaction.channel.id}`)
    .setTitle('request more info');

  const q = new TextInputBuilder()
    .setCustomId('moreinfo-question')
    .setLabel('what do you want to ask')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('ask whatever you need');

  modal.addComponents(new ActionRowBuilder().addComponents(q));

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

  const parts = interaction.customId.split(':');
  const threadId = parts[3];
  const submission = storage.getSubmissionByThreadId(threadId);

  if (!submission) {
    await interaction.reply({
      content: 'could not find the linked submission anymore',
      ephemeral: true,
    });
    return;
  }

  const q = interaction.fields.getTextInputValue('moreinfo-question').trim();
  const u = await interaction.client.users.fetch(submission.userId).catch(() => null);

  if (!u) {
    await interaction.reply({
      content: 'could not find that user',
      ephemeral: true,
    });
    return;
  }

  try {
    // mod wants more info so we just dm them
    await u.send(`mod question: ${q}`);
  } catch (error) {
    await interaction.reply({
      content: 'could not dm that user',
      ephemeral: true,
    });
    return;
  }

  // storing temp reply state kinda messy but works
  waitingReplies[submission.userId] = {
    question: q,
    threadId,
  };

  await interaction.reply({
    content: 'sent the question in dm',
    ephemeral: true,
  });
}

async function handleMoreInfoDmReply(message) {
  if (message.author.bot) {
    return;
  }

  if (message.guildId) {
    return;
  }

  const temp = waitingReplies[message.author.id];

  if (!temp) {
    return;
  }

  const text = message.content.trim();

  if (!text) {
    await message.channel.send('send some text and i will pass it to mods');
    return;
  }

  const t = await message.client.channels.fetch(temp.threadId).catch(() => null);

  if (!t || !t.isTextBased()) {
    delete waitingReplies[message.author.id];
    await message.channel.send('could not find the mod thread anymore');
    return;
  }

  await t.send({
    content: `**reply to mod question**\nquestion: ${temp.question}\nreply: ${text}`,
  });

  delete waitingReplies[message.author.id];
  await message.channel.send('sent back to mods');
}

function noteThreadStuff(message) {
  if (!message.channel || !message.channel.isThread()) {
    return;
  }

  threadLastActive[message.channel.id] = Date.now();
}

async function checkDeadThreads(client) {
  const stuff = storage.getAllSubmissions();
  const now = Date.now();

  for (const item of stuff) {
    if (!item.threadId) {
      continue;
    }

    if (item.closedAt || item.resolvedAt) {
      continue;
    }

    const thread = await client.channels.fetch(item.threadId).catch(() => null);

    if (!thread || !thread.isThread()) {
      continue;
    }

    if (thread.archived || thread.locked) {
      storage.updateSubmission(item.submissionId, {
        closedAt: item.closedAt || new Date().toISOString(),
        closedBy: item.closedBy || 'unknown',
      });
      delete threadLastActive[item.threadId];
      continue;
    }

    let last = threadLastActive[item.threadId];

    if (!last && thread.lastMessageId) {
      const msg = await thread.messages.fetch(thread.lastMessageId).catch(() => null);

      if (msg) {
        last = msg.createdTimestamp;
      }
    }

    if (!last) {
      last = new Date(item.approvedAt || item.createdAt).getTime();
    }

    threadLastActive[item.threadId] = last;

    if (now - last < DEAD_MS) {
      continue;
    }

    // check dead threads and close them
    await thread.setLocked(true, 'inactive for too long').catch(() => null);
    await thread.setArchived(true, 'inactive for too long').catch(() => null);

    storage.updateSubmission(item.submissionId, {
      closedAt: new Date().toISOString(),
      closedBy: 'auto-inactive',
    });

    delete threadLastActive[item.threadId];
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

function formatSubmissionLine(submission) {
  const cleanContent = submission.content.length > 120
    ? `${submission.content.slice(0, 117)}...`
    : submission.content;
  const timestampBits = [
    `submitted: <t:${Math.floor(new Date(submission.createdAt).getTime() / 1000)}:f>`,
  ];

  if (submission.approvedAt) {
    timestampBits.push(`approved: <t:${Math.floor(new Date(submission.approvedAt).getTime() / 1000)}:f>`);
  }

  if (submission.rejectedAt) {
    timestampBits.push(`rejected: <t:${Math.floor(new Date(submission.rejectedAt).getTime() / 1000)}:f>`);
  }

  if (submission.closedAt) {
    timestampBits.push(`closed: <t:${Math.floor(new Date(submission.closedAt).getTime() / 1000)}:f>`);
  }

  if (submission.resolvedAt) {
    timestampBits.push(`resolved: <t:${Math.floor(new Date(submission.resolvedAt).getTime() / 1000)}:f>`);
  }

  return [
    `**${submission.submissionId}**`,
    `status: ${submission.status}`,
    timestampBits.join(' | '),
    cleanContent,
  ].join('\n');
}

async function handleSearchAnonCommand(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({
      content: 'you need Manage Threads for this',
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

  const anonId = interaction.options.getString('anon-id', true).trim().toLowerCase();
  const submissions = storage.findSubmissionsByAnon(interaction.guildId, anonId);

  if (!submissions.length) {
    await interaction.reply({
      content: `no submissions found for \`${anonId}\``,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`search results for ${anonId}`)
    .setColor(0x5865f2)
    .setDescription(submissions.map(formatSubmissionLine).join('\n\n'))
    .setFooter({ text: `${submissions.length} submission(s)` });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

module.exports = {
  checkDeadThreads,
  handleMoreInfoDmReply,
  handleResolvedButton,
  handleRequestMoreInfoButton,
  handleRequestMoreInfoModal,
  handleCloseButton,
  handleReplyCommand,
  handleReviewButton,
  handleSearchAnonCommand,
  noteThreadStuff,
  startDeadThreadLoop,
};
