const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const {
  errEmbed,
  infoBox,
  okEmbed,
  warnBox,
} = require('../utils/responseEmbeds');
const runtimeStore = require('../utils/runtimeStore');

const oldBits = runtimeStore.readState();
const tossCache = new Map((oldBits.tossRooms || []).map((item) => [item.userId, item]));

function saveTossBits() {
  runtimeStore.saveTossState(tossCache);
}

function hasRoleSomewhere(memberLike, roleId) {
  if (!memberLike?.roles || !roleId) {
    return false;
  }

  if (Array.isArray(memberLike.roles)) {
    return memberLike.roles.includes(roleId);
  }

  return memberLike.roles.cache?.has(roleId) || false;
}

function canUseTossStuff(interaction) {
  const modRoleId = interaction.client.botConfig.tossModRoleId;

  if (modRoleId) {
    return hasRoleSomewhere(interaction.member, modRoleId);
  }

  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;
}

function tossDeniedText(interaction) {
  if (interaction.client.botConfig.tossModRoleId) {
    return 'You need the configured toss/mod role for that.';
  }

  return 'You need `Manage Channels` for that.';
}

function squishName(raw) {
  return (raw || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'member';
}

function buildRoomName(person) {
  return `toss-${squishName(person.displayName || person.user?.username || person.username)}`;
}

function buildDoneRoomName(person, userId) {
  const bit = squishName(person?.displayName || person?.user?.username || 'closed-room');
  return `closed-${bit}-${userId.slice(-4)}`;
}

function getTossByRoom(channelId) {
  for (const item of tossCache.values()) {
    if (item.roomId === channelId) {
      return item;
    }
  }

  return null;
}

function controlRow(userId, isLocked, isClosed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`toss:close:${userId}`)
      .setLabel('Close Room')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`toss:${isLocked ? 'unlock' : 'lock'}:${userId}`)
      .setLabel(isLocked ? 'Unlock Member' : 'Lock Member')
      .setStyle(isLocked ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(isClosed),
  );
}

function buildControlCard(savedThing, member) {
  const roomState = savedThing.closedAt
    ? 'closed'
    : (savedThing.isLocked ? 'locked' : 'open');

  return infoBox('Moderator Controls', [
    `**Member:** <@${savedThing.userId}>`,
    `**Status:** ${roomState}`,
    `**Stored Roles:** ${savedThing.roleIds.length}`,
    `**Opened By:** <@${savedThing.createdBy}>`,
    member ? `**Display Name:** ${member.displayName}` : null,
    '',
    'Use `Close Room` when the talk is done. That gives the member their saved roles back and hides this room from them.',
    savedThing.isLocked
      ? 'The member is currently locked from sending in this room.'
      : 'The member can currently reply in this room.',
  ]);
}

function buildWelcomeCard(member, reasonText) {
  return okEmbed('Private Support Room', [
    `<@${member.id}> is not in trouble just because this room exists.`,
    'This is a private conference room so staff and the member can slow things down, talk clearly, and figure out what is actually going on before anyone jumps to a harder call.',
    '',
    reasonText ? `**Why this was opened:** ${reasonText}` : 'A moderator did not add a reason yet.',
  ]);
}

async function fetchTossRoom(guild, roomId) {
  const cached = guild.channels.cache.get(roomId);

  if (cached) {
    return cached;
  }

  return guild.channels.fetch(roomId).catch(() => null);
}

function getEditableRoles(member, me) {
  return member.roles.cache.filter((role) => (
    role.id !== member.guild.id
    && !role.managed
    && me.roles.highest.comparePositionTo(role) > 0
  ));
}

function getStickyRoles(member, me) {
  return member.roles.cache.filter((role) => (
    role.id !== member.guild.id
    && (role.managed || me.roles.highest.comparePositionTo(role) <= 0)
  ));
}

async function closeOutToss(guild, savedThing, actorUser, extraBits = {}) {
  const room = await fetchTossRoom(guild, savedThing.roomId);
  const person = await guild.members.fetch(savedThing.userId).catch(() => null);
  const goodRoleIds = savedThing.roleIds.filter((roleId) => guild.roles.cache.has(roleId));
  const missingRoleIds = savedThing.roleIds.filter((roleId) => !guild.roles.cache.has(roleId));
  const tossRollId = savedThing.tossRollId || '';

  if (person && tossRollId && person.roles.cache.has(tossRollId)) {
    await person.roles.remove(tossRollId, `untossed by ${actorUser.tag}`).catch(() => null);
  }

  if (person && goodRoleIds.length > 0) {
    await person.roles.add(goodRoleIds, `untossed by ${actorUser.tag}`);
  }

  if (room && room.type === ChannelType.GuildText) {
    await room.permissionOverwrites.edit(savedThing.userId, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false,
    }, {
      reason: `toss room closed by ${actorUser.tag}`,
    }).catch(() => null);

    await room.setName(
      buildDoneRoomName(person, savedThing.userId),
      `toss room closed by ${actorUser.tag}`,
    ).catch(() => null);

    await room.send({
      embeds: [okEmbed('Room Closed', [
        `<@${savedThing.userId}> has been untossed.`,
        goodRoleIds.length > 0
          ? `Restored ${goodRoleIds.length} saved role${goodRoleIds.length === 1 ? '' : 's'}.`
          : 'There were no saved roles to restore.',
        missingRoleIds.length > 0
          ? `${missingRoleIds.length} old role${missingRoleIds.length === 1 ? '' : 's'} could not be restored because they no longer exist.`
          : null,
        extraBits.note || null,
      ])],
      components: [controlRow(savedThing.userId, savedThing.isLocked, true)],
    }).catch(() => null);
  }

  tossCache.delete(savedThing.userId);
  saveTossBits();

  return {
    roomId: savedThing.roomId,
    restored: goodRoleIds.length,
    missingRoles: missingRoleIds.length,
    memberFound: Boolean(person),
  };
}

async function openTossRoom(interaction, member, reasonText) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'This command only works inside the server.')],
      ephemeral: true,
    });
    return;
  }

  if (!canUseTossStuff(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', tossDeniedText(interaction))],
      ephemeral: true,
    });
    return;
  }

  const config = interaction.client.botConfig;
  const guild = interaction.guild;
  const me = guild.members.me || await guild.members.fetchMe();

  if (!config.supportRoleId || !config.tossRollId) {
    await interaction.reply({
      embeds: [errEmbed(
        'Missing Toss Setup',
        'Set `SUPPORT_ROLE_ID` and `TOSS_ROLL` in the env before using this.',
      )],
      ephemeral: true,
    });
    return;
  }

  if (member.user.bot) {
    await interaction.reply({
      embeds: [warnBox('Nope', 'Tossing bots is just going to make this weird.')],
      ephemeral: true,
    });
    return;
  }

  if (member.id === guild.ownerId) {
    await interaction.reply({
      embeds: [warnBox('Nope', 'The server owner is not a valid toss target.')],
      ephemeral: true,
    });
    return;
  }

  if (member.id === interaction.user.id) {
    await interaction.reply({
      embeds: [warnBox('Nope', 'You do not need a private moderation room with yourself.')],
      ephemeral: true,
    });
    return;
  }

  const alreadyOpen = tossCache.get(member.id);

  if (alreadyOpen) {
    await interaction.reply({
      embeds: [warnBox('Already Tossed', [
        `${member} already has a toss room open.`,
        alreadyOpen.roomId ? `Current room: <#${alreadyOpen.roomId}>` : null,
      ])],
      ephemeral: true,
    });
    return;
  }

  const supportRole = guild.roles.cache.get(config.supportRoleId) || await guild.roles.fetch(config.supportRoleId).catch(() => null);
  const tossRoll = guild.roles.cache.get(config.tossRollId) || await guild.roles.fetch(config.tossRollId).catch(() => null);

  if (!supportRole) {
    await interaction.reply({
      embeds: [errEmbed('Missing Support Role', 'I could not find the configured `SUPPORT_ROLE_ID` role.')],
      ephemeral: true,
    });
    return;
  }

  if (!tossRoll) {
    await interaction.reply({
      embeds: [errEmbed('Missing Toss Role', 'I could not find the configured `TOSS_ROLL` role.')],
      ephemeral: true,
    });
    return;
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      embeds: [errEmbed('Missing Permission', 'I need both `Manage Channels` and `Manage Roles` for the toss flow.')],
      ephemeral: true,
    });
    return;
  }

  if (interaction.member && interaction.member.roles?.highest) {
    const actorTop = interaction.member.roles.highest;

    if (actorTop.comparePositionTo(member.roles.highest) <= 0 && interaction.user.id !== guild.ownerId) {
      await interaction.reply({
        embeds: [warnBox('Role Order Problem', 'You can only toss members below your highest role.')],
        ephemeral: true,
      });
      return;
    }
  }

  if (me.roles.highest.comparePositionTo(tossRoll) <= 0) {
    await interaction.reply({
      embeds: [errEmbed('Role Order Problem', 'Move my highest role above the configured toss role first.')],
      ephemeral: true,
    });
    return;
  }

  const rolePile = getEditableRoles(member, me).filter((role) => role.id !== tossRoll.id);
  const savedRoleIds = rolePile.map((role) => role.id);
  const stickyOnes = getStickyRoles(member, me).filter((role) => role.id !== tossRoll.id);

  if (stickyOnes.size > 0) {
    await interaction.reply({
      embeds: [errEmbed('Role Order Problem', [
        'I cannot safely toss this member because some of their roles are above me or managed by Discord/integrations.',
        `Problem roles: ${stickyOnes.map((role) => role.name).join(', ')}`,
      ])],
      ephemeral: true,
    });
    return;
  }

  const room = await guild.channels.create({
    name: buildRoomName(member),
    type: ChannelType.GuildText,
    topic: `toss room for ${member.user.tag} (${member.id})`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: supportRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
    reason: `toss room opened by ${interaction.user.tag}`,
  });

  try {
    if (savedRoleIds.length > 0) {
      await member.roles.remove(savedRoleIds, `tossed by ${interaction.user.tag}`);
    }

    if (!member.roles.cache.has(tossRoll.id)) {
      await member.roles.add(tossRoll, `tossed by ${interaction.user.tag}`);
    }
  } catch (error) {
    if (member.roles.cache.has(tossRoll.id)) {
      await member.roles.remove(tossRoll.id, `rolling back failed toss for ${member.user.tag}`).catch(() => null);
    }

    if (savedRoleIds.length > 0) {
      await member.roles.add(savedRoleIds, `rolling back failed toss for ${member.user.tag}`).catch(() => null);
    }

    await room.delete(`could not finish toss for ${member.user.tag}`).catch(() => null);
    throw error;
  }

  const savedThing = {
    guildId: guild.id,
    userId: member.id,
    roomId: room.id,
    roleIds: savedRoleIds,
    tossRollId: tossRoll.id,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    reasonText: reasonText || '',
    isLocked: false,
  };

  tossCache.set(member.id, savedThing);
  saveTossBits();

  await room.send({
    content: `<@&${supportRole.id}> <@${member.id}>`,
    allowedMentions: {
      roles: [supportRole.id],
      users: [member.id],
    },
    embeds: [
      buildWelcomeCard(member, reasonText),
      buildControlCard(savedThing, member),
    ],
    components: [controlRow(member.id, false)],
  });

  await interaction.reply({
    embeds: [okEmbed('Toss Room Opened', [
      `Made ${room} for ${member}.`,
      `Saved ${savedThing.roleIds.length} role${savedThing.roleIds.length === 1 ? '' : 's'} so they can be restored later.`,
      `Applied the toss role: <@&${tossRoll.id}>.`,
    ])],
    ephemeral: true,
  });
}

async function untossMember(interaction, member) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'This command only works inside the server.')],
      ephemeral: true,
    });
    return;
  }

  if (!canUseTossStuff(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', tossDeniedText(interaction))],
      ephemeral: true,
    });
    return;
  }

  const savedThing = tossCache.get(member.id);

  if (!savedThing) {
    await interaction.reply({
      embeds: [warnBox('Not Tossed', `${member} does not have an active toss room right now.`)],
      ephemeral: true,
    });
    return;
  }

  const result = await closeOutToss(interaction.guild, savedThing, interaction.user, {
    note: `Closed manually by <@${interaction.user.id}>.`,
  });

  await interaction.reply({
    embeds: [okEmbed('Untossed', [
      `${member} has their access back.`,
      result.roomId ? `Staff transcript room: <#${result.roomId}>` : null,
      result.memberFound
        ? `Restored ${result.restored} saved role${result.restored === 1 ? '' : 's'}.`
        : 'The member is no longer in the server, so there were no roles to restore.',
      result.missingRoles > 0
        ? `${result.missingRoles} saved role${result.missingRoles === 1 ? '' : 's'} were skipped because they no longer exist.`
        : null,
    ])],
    ephemeral: true,
  });
}

async function handleTossButton(interaction) {
  if (!canUseTossStuff(interaction)) {
    await interaction.reply({
      embeds: [warnBox('Not Allowed', tossDeniedText(interaction))],
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [warnBox('Wrong Place', 'That button only works inside a toss room.')],
      ephemeral: true,
    });
    return;
  }

  const savedThing = getTossByRoom(interaction.channel.id);

  if (!savedThing) {
    await interaction.reply({
      embeds: [warnBox('Toss Missing', 'I do not have the toss state for this room anymore.')],
      ephemeral: true,
    });
    return;
  }

  const [, action, userId] = interaction.customId.split(':');

  if (savedThing.userId !== userId) {
    await interaction.reply({
      embeds: [warnBox('Toss Mismatch', 'That control panel is out of sync with the saved toss record.')],
      ephemeral: true,
    });
    return;
  }

  if (action === 'close') {
    const result = await closeOutToss(interaction.guild, savedThing, interaction.user, {
      note: `Closed from the panel by <@${interaction.user.id}>.`,
    });

    await interaction.update({
      embeds: [okEmbed('Room Closed', [
        `<@${savedThing.userId}> has been untossed.`,
        result.memberFound
          ? `Restored ${result.restored} saved role${result.restored === 1 ? '' : 's'}.`
          : 'The member is no longer in the server, so there were no roles to restore.',
        result.missingRoles > 0
          ? `${result.missingRoles} old role${result.missingRoles === 1 ? '' : 's'} could not be restored because they no longer exist.`
          : null,
      ])],
      components: [controlRow(savedThing.userId, savedThing.isLocked, true)],
    });
    return;
  }

  if (action !== 'lock' && action !== 'unlock') {
    await interaction.reply({
      embeds: [warnBox('Unknown Control', 'That toss button is not one I know how to handle.')],
      ephemeral: true,
    });
    return;
  }

  const memberCanTalk = action === 'unlock';

  await interaction.channel.permissionOverwrites.edit(savedThing.userId, {
    ViewChannel: true,
    SendMessages: memberCanTalk,
    ReadMessageHistory: true,
  }, {
    reason: `toss room ${action} by ${interaction.user.tag}`,
  });

  const nextData = {
    ...savedThing,
    isLocked: !memberCanTalk,
    lockedAt: new Date().toISOString(),
    lockedBy: interaction.user.id,
  };

  tossCache.set(savedThing.userId, nextData);
  saveTossBits();

  const liveMember = await interaction.guild.members.fetch(savedThing.userId).catch(() => null);

  await interaction.update({
    embeds: [
      buildWelcomeCard(liveMember || { toString: () => `<@${savedThing.userId}>` }, savedThing.reasonText),
      buildControlCard(nextData, liveMember),
    ],
    components: [controlRow(savedThing.userId, nextData.isLocked)],
  });

  await interaction.channel.send({
    embeds: [infoBox(memberCanTalk ? 'Room Unlocked' : 'Room Locked', [
      memberCanTalk
        ? `<@${savedThing.userId}> can send messages in here again.`
        : `<@${savedThing.userId}> has been temporarily locked from sending in here.`,
      `Changed by <@${interaction.user.id}>.`,
    ])],
  }).catch(() => null);
}

module.exports = {
  handleTossButton,
  openTossRoom,
  untossMember,
};
