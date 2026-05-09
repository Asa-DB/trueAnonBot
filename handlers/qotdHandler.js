const { EmbedBuilder, ThreadAutoArchiveDuration } = require('discord.js');
const runtimeStore = require('../utils/runtimeStore');

const CHECK_EVERY_MS = 60 * 1000;
const API_TIMEOUT_MS = 30_000;
const RECENT_QOTD_LIMIT = 10;
const RETRY_DELAY_MS = 5 * 60 * 1000;

const savedStuff = runtimeStore.readState();
const qotdState = {
  lastPostedDay: savedStuff.qotdState?.lastPostedDay || '',
  lastPostedAt: savedStuff.qotdState?.lastPostedAt || '',
  nextTryAt: savedStuff.qotdState?.nextTryAt || '',
  recentQuestions: Array.isArray(savedStuff.qotdState?.recentQuestions)
    ? savedStuff.qotdState.recentQuestions
    : [],
};

function saveQotdState() {
  runtimeStore.saveQotdState(qotdState);
}

function getEtTimeBits(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    if (part.type === 'literal') {
      continue;
    }

    map[part.type] = part.value;
  }

  return {
    dayKey: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday || '',
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function shouldPostNow(config, nowBits) {
  if (nowBits.dayKey === qotdState.lastPostedDay) {
    return false;
  }

  if (nowBits.hour > config.qotdHour) {
    return true;
  }

  return nowBits.hour === config.qotdHour && nowBits.minute >= config.qotdMinute;
}

function cleanupQuestion(text) {
  if (!text) {
    return '';
  }

  let cleaned = text.trim();

  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/^\s*(question of the day|qotd)\s*[:\-]\s*/i, '');
  cleaned = cleaned.replace(/\n+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

function makePrompt(config) {
  const recent = qotdState.recentQuestions.length
    ? qotdState.recentQuestions.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'None yet';
  const vibeLine = getQuietThemeHint(config.qotdTimezone);

  return [
    'Write one question of the day for a Discord server.',
    'Make it insightful, unique, a little surprising, and actually good for conversation.',
    'Avoid boring icebreakers, yes/no questions, and fake-deep fluff.',
    'Do not repeat or closely echo any recent questions.',
    'Return only the final question. No label. No numbering. No quotation marks.',
    '',
    'Recent questions to avoid:',
    recent,
    '',
    vibeLine,
    `Timezone context: ${config.qotdTimezone}.`,
  ].join('\n');
}

function getQuietThemeHint(timeZone) {
  const today = getEtTimeBits(timeZone).weekday;

  if (today === 'Monday') {
    return 'Lean a little more reflective and reset-oriented, but keep it natural.';
  }

  if (today === 'Tuesday') {
    return 'Slightly favor personal perspective and thoughtful opinions.';
  }

  if (today === 'Wednesday') {
    return 'A mild weird-hypothetical angle is good if it still feels conversation-worthy.';
  }

  if (today === 'Thursday') {
    return 'Lean a bit more honest, observant, or quietly revealing.';
  }

  if (today === 'Friday') {
    return 'Let it feel looser, playful, or socially fun without getting shallow.';
  }

  if (today === 'Saturday') {
    return 'A more offbeat, curious, or imaginative question works well.';
  }

  if (today === 'Sunday') {
    return 'Lean slightly calmer, reflective, or future-looking.';
  }

  return 'Keep the tone balanced and natural.';
}

async function askForQotd(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(config.qotdApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.qotdApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.qotdModel,
        messages: [
          {
            role: 'system',
            content: 'You write strong, natural question-of-the-day prompts for online communities.',
          },
          {
            role: 'user',
            content: makePrompt(config),
          },
        ],
        temperature: 1,
        max_tokens: 120,
        stream: false,
      }),
    });

    if (!response.ok) {
      const problemText = await response.text().catch(() => '');
      throw new Error(`qotd api failed with status ${response.status}${problemText ? `: ${problemText}` : ''}`);
    }

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content || '';
    const question = cleanupQuestion(rawText);

    if (!question) {
      throw new Error('qotd api returned an empty question');
    }

    return question;
  } finally {
    clearTimeout(timeout);
  }
}

function shortTime(num) {
  return String(num).padStart(2, '0');
}

function prettyDate(rawIso) {
  if (!rawIso) {
    return '';
  }

  const maybeDate = new Date(rawIso);

  if (Number.isNaN(maybeDate.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(maybeDate);
}

function buildQotdEmbed(question, nowBits) {
  const prettyToday = prettyDate(new Date().toISOString());

  const embed = new EmbedBuilder()
    .setColor(0xe0af68)
    .setTitle('Question Of The Day')
    .setDescription(`**${question}**`)
    .addFields(
      {
        name: 'Answer Prompt',
        value: 'Throw your answer in chat. Serious, funny, personal, or weird all work.',
      },
      {
        name: 'Posted',
        value: `${shortTime(nowBits.hour)}:${shortTime(nowBits.minute)} ET`,
        inline: true,
      },
    );

  if (prettyToday) {
    embed.setFooter({
      text: prettyToday,
    });
  }

  return embed;
}

function makeThreadName(question, nowBits) {
  const shortQuestion = question.length > 55
    ? `${question.slice(0, 52).trimEnd()}...`
    : question;

  return `qotd ${nowBits.dayKey} - ${shortQuestion}`;
}

function rememberQuestion(question, dayKey) {
  qotdState.lastPostedDay = dayKey;
  qotdState.lastPostedAt = new Date().toISOString();
  qotdState.nextTryAt = '';
  qotdState.recentQuestions.unshift(question);

  if (qotdState.recentQuestions.length > RECENT_QOTD_LIMIT) {
    qotdState.recentQuestions = qotdState.recentQuestions.slice(0, RECENT_QOTD_LIMIT);
  }

  saveQotdState();
}

function canTryAgainYet() {
  if (!qotdState.nextTryAt) {
    return true;
  }

  const nextTryDate = new Date(qotdState.nextTryAt);

  if (Number.isNaN(nextTryDate.getTime())) {
    return true;
  }

  return Date.now() >= nextTryDate.getTime();
}

function scheduleRetry() {
  qotdState.nextTryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
  saveQotdState();
}

async function sendQotd(client, question, nowBits) {
  const channel = await client.channels.fetch(client.botConfig.qotdChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('qotd channel is missing or not text-based');
  }

  const roleId = client.botConfig.qotdPingRoleId;
  const pingText = roleId ? `<@&${roleId}> ` : '';

  const sentMessage = await channel.send({
    content: `${pingText}New QOTD just dropped.`,
    allowedMentions: roleId ? { roles: [roleId] } : undefined,
    embeds: [buildQotdEmbed(question, nowBits)],
  });

  const thread = await sentMessage.startThread({
    name: makeThreadName(question, nowBits),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: 'daily qotd discussion thread',
  });

  await thread.send('Reply here with your answer so the main channel does not get too messy.');
}

async function checkQotd(client) {
  const config = client.botConfig;

  if (!config.qotdChannelId || !config.qotdApiKey) {
    return;
  }

  const nowBits = getEtTimeBits(config.qotdTimezone);

  if (!shouldPostNow(config, nowBits)) {
    return;
  }

  try {
    if (!canTryAgainYet()) {
      return;
    }

    const question = await askForQotd(config);
    await sendQotd(client, question, nowBits);
    rememberQuestion(question, nowBits.dayKey);
  } catch (error) {
    console.error('qotd generation failed, trying again in 5 minutes');
    console.error(error);
    scheduleRetry();
  }
}

function startQotdLoop(client) {
  if (!client.botConfig.qotdChannelId || !client.botConfig.qotdApiKey) {
    return;
  }

  setInterval(() => {
    checkQotd(client).catch((error) => {
      console.error('qotd check failed');
      console.error(error);
    });
  }, CHECK_EVERY_MS);
}

module.exports = {
  checkQotd,
  startQotdLoop,
};
