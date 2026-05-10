const {
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { errEmbed, okEmbed, warnBox } = require('../utils/responseEmbeds');

const yearSteps = [
  { key: 'freshman', label: 'Freshman' },
  { key: 'sophomore', label: 'Sophomore' },
  { key: 'junior', label: 'Junior' },
  { key: 'senior', label: 'Senior' },
  { key: 'graduate', label: 'Graduate' },
];

const sendoffLines = [
  'You do not need to have everything figured out to be ready for what comes next.',
  'A long year can wear you down, but it can also prove how much stronger you are than you thought.',
  'The version of you that started this year is not the same one standing here now, and that matters.',
  'Sometimes finishing the year is its own kind of victory, even before the next one begins.',
  'The next chapter is built from every tired morning, every hard lesson, and every small step you kept taking.',
];

function grabYears(config) {
  return yearSteps.map((year) => ({
    ...year,
    roleId: config.gradeRoleIds?.[year.key] || '',
  }));
}

function randomLine() {
  const i = Math.floor(Math.random() * sendoffLines.length);
  return sendoffLines[i];
}

function roleLine(count, label) {
  const word = count === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`;
  return `**${count} ${word}**`;
}

function statLine(label, count) {
  const word = count === 1 ? 'member' : 'members';
  return `**${label}:** ${count} ${word}`;
}

function countNow(allMembers, years) {
  return years.map((year) => {
    const total = allMembers.reduce((sum, person) => {
      if (!person.roles.cache.has(year.roleId)) {
        return sum;
      }

      return sum + 1;
    }, 0);

    return {
      label: year.label,
      total,
    };
  });
}

function splitUp(lines, maxLen = 1800) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > maxLen) {
      if (current) {
        chunks.push(current);
      }

      current = line;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function sendMissReport(user, guildName, moved, misses, peopleWhoMissed) {
  const top = [
    `Grade rollover report for ${guildName}`,
    '',
    statLine('Updated', moved),
    statLine('Skipped', misses),
    '',
  ];

  if (peopleWhoMissed.length === 0) {
    top.push('Nobody was skipped this time.');
  } else {
    top.push('These members did not seem to get updated:');
    top.push(...peopleWhoMissed.map((item) => `- ${item.name} (${item.id}) - ${item.reason}`));
  }

  const parts = splitUp(top);

  for (const part of parts) {
    await user.send(part);
  }
}

function buildPost({ moved, misses, whoRanIt, totals, guildName, guildIcon }) {
  const issueLine = misses > 0
    ? 'Some members still need a manual look, so please contact the staff team if there are any issues.'
    : 'If there are any issues with someone\'s role, please contact the staff team and they can fix it.';

  const card = new EmbedBuilder()
    .setColor(0x9ece6a)
    .setTitle('Grade Promotion Complete')
    .setDescription([
      'Another school year is finally in the books.',
      '',
      'Happy graduation to the senior class, and congratulations to everyone stepping into a new grade after a long year of classes, deadlines, stress, growth, and making it through anyway.',
      '',
      issueLine,
    ].join('\n'))
    .addFields(
      {
        name: 'Rollover Summary',
        value: [
          statLine('Updated Successfully', moved),
          statLine('Skipped', misses),
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Inspirational Quote',
        value: `“${randomLine()}”`,
        inline: true,
      },
      {
        name: 'Where Everyone Landed',
        value: totals.map((item) => roleLine(item.total, item.label)).join('\n'),
      },
      {
        name: 'A Note From Spar-chan',
        value: [
          'I-it is not like I was sitting here getting emotional over your entire school year or anything...',
          'but seriously, making it to the end of a long year is a big deal.',
          'A lot of people only notice the grades, the schedules, or the deadlines, and they miss how much effort it takes just to keep showing up when you are tired, stressed, or doubting yourself.',
          'If you made it here, then you made it through something. Be proud of that. Take the win, take the breath, and carry that into whatever comes next.',
          'And to the graduates... congratulations. You earned this one.',
        ].join(' '),
      },
    )
    .setFooter({
      text: `Ran by ${whoRanIt}`,
    })
    .setTimestamp();

  if (guildName) {
    card.setAuthor({
      name: guildName,
      iconURL: guildIcon || undefined,
    });
  }

  return card;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promotegrades')
    .setDescription('move each student to the next configured grade role and post a graduation announcement')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        embeds: [errEmbed('Wrong Place', 'This command only works inside the server.')],
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== interaction.guild.ownerId) {
      await interaction.reply({
        embeds: [warnBox('Owner Only', [
          'Only the server owner can run this promotion command.',
          'Hmph. That kind of mass role change is not something I hand out casually.',
        ])],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const years = grabYears(interaction.client.botConfig);
    const missingStuff = years.filter((year) => !year.roleId);

    if (missingStuff.length > 0) {
      await interaction.editReply({
        embeds: [errEmbed(
          'Missing Grade Roles',
          `Set these env vars before using this command: ${missingStuff.map((year) => `GRADE_ROLE_${year.key.toUpperCase()}_ID`).join(', ')}`,
        )],
      });
      return;
    }

    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        embeds: [errEmbed('Missing Permission', 'I need the `Manage Roles` permission before I can promote anyone.')],
      });
      return;
    }

    await interaction.guild.roles.fetch();

    const yearsWithRole = years.map((year) => ({
      ...year,
      role: interaction.guild.roles.cache.get(year.roleId) || null,
    }));
    const badRoles = yearsWithRole.filter((year) => !year.role);

    if (badRoles.length > 0) {
      await interaction.editReply({
        embeds: [errEmbed(
          'Role Not Found',
          `I could not find these configured roles in the server: ${badRoles.map((year) => year.label).join(', ')}`,
        )],
      });
      return;
    }

    const tooHigh = yearsWithRole.filter(
      (year) => me.roles.highest.comparePositionTo(year.role) <= 0,
    );

    if (tooHigh.length > 0) {
      await interaction.editReply({
        embeds: [errEmbed(
          'Role Order Problem',
          `Move my highest role above these class roles first: ${tooHigh.map((year) => year.label).join(', ')}`,
        )],
      });
      return;
    }

    await interaction.guild.members.fetch();

    const allYearIds = new Set(yearsWithRole.map((year) => year.roleId));
    let moved = 0;
    let misses = 0;
    const peopleWhoMissed = [];

    for (const person of interaction.guild.members.cache.values()) {
      if (person.user.bot) {
        continue;
      }

      const currentYears = yearsWithRole
        .map((year, idx) => (person.roles.cache.has(year.roleId) ? idx : -1))
        .filter((index) => index >= 0);

      if (currentYears.length === 0) {
        continue;
      }

      const hereNow = Math.max(...currentYears);

      if (hereNow >= yearsWithRole.length - 1) {
        continue;
      }

      if (!person.manageable) {
        misses += 1;
        peopleWhoMissed.push({
          name: person.user.tag,
          id: person.id,
          reason: 'the bot could not manage this member because of role order or server permissions',
        });
        continue;
      }

      const nextUp = yearsWithRole[hereNow + 1];
      const oldStuff = person.roles.cache
        .filter((role) => allYearIds.has(role.id))
        .map((role) => role.id);

      try {
        if (oldStuff.length > 0) {
          await person.roles.remove(
            oldStuff,
            `Academic year rollover requested by ${interaction.user.tag}`,
          );
        }

        await person.roles.add(
          nextUp.roleId,
          `Academic year rollover requested by ${interaction.user.tag}`,
        );
        moved += 1;
      } catch (error) {
        console.error(`failed to promote member ${person.user.tag}`);
        console.error(error);
        misses += 1;
        peopleWhoMissed.push({
          name: person.user.tag,
          id: person.id,
          reason: error?.message || 'Discord rejected the role update',
        });
      }
    }

    const regularPeople = [...interaction.guild.members.cache.values()].filter((person) => !person.user.bot);
    const totals = countNow(regularPeople, yearsWithRole);
    let dmWorked = true;

    try {
      await sendMissReport(
        interaction.user,
        interaction.guild.name,
        moved,
        misses,
        peopleWhoMissed,
      );
    } catch (error) {
      console.error('failed to DM rollover report');
      console.error(error);
      dmWorked = false;
    }

    const announcementEmbed = buildPost({
      moved,
      misses,
      whoRanIt: interaction.user.tag,
      totals,
      guildName: interaction.guild.name,
      guildIcon: interaction.guild.iconURL({ size: 256 }),
    });

    try {
      await interaction.channel.send({
        content: '@everyone',
        embeds: [announcementEmbed],
        allowedMentions: { parse: ['everyone'] },
      });
    } catch (error) {
      console.error('failed to send promotion announcement');
      console.error(error);

      await interaction.editReply({
        embeds: [warnBox('Promotion Complete, Announcement Failed', [
          `I updated ${moved} member${moved === 1 ? '' : 's'}.`,
          'The public announcement did not send, so check my channel permissions and try again if you still want the embed post.',
        ])],
      });
      return;
    }

    await interaction.editReply({
      embeds: [okEmbed('Promotion Complete', [
        `Updated ${moved} member${moved === 1 ? '' : 's'} to the next grade role.`,
        `Skipped ${misses} member${misses === 1 ? '' : 's'}.`,
        'The graduation announcement has been posted in this channel.',
        dmWorked
          ? 'I also sent you a DM with the rollover report and any skipped members.'
          : 'I could not DM you the rollover report, so check your Discord privacy settings if you still want that skipped-member list.',
      ])],
    });
  },
};
