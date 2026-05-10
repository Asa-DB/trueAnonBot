const { EmbedBuilder, ThreadAutoArchiveDuration } = require('discord.js');
const runtimeStore = require('../utils/runtimeStore');

const CHECK_EVERY_MS = 60 * 1000;
const API_TIMEOUT_MS = 30_000;
const RECENT_QOTD_LIMIT = 10;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_QOTD_ATTEMPTS = 3;

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

  if (cleaned && !/[?؟]$/.test(cleaned)) {
    cleaned = `${cleaned.replace(/[.!]+$/g, '')}?`;
  }

  return cleaned;
}

function normalizeQuestion(text) {
  return cleanupQuestion(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isRecentQuestion(question) {
  const normalized = normalizeQuestion(question);

  if (!normalized) {
    return false;
  }

  return qotdState.recentQuestions.some((item) => normalizeQuestion(item) === normalized);
}

function hasPromptLeak(question) {
  const lowered = question.toLowerCase();
  const markers = [
    'write one question of the day',
    'return only',
    'examples:',
    'recent questions to avoid',
    'under 20 words',
    'therapy-speak',
    'icebreakers',
    'conversational',
    'fake-deep',
    'brand prompt',
    'one sentence',
    'timezone context',
  ];

  return markers.some((marker) => lowered.includes(marker));
}

function isValidQuestion(question) {
  if (!question) {
    return false;
  }

  const wordCount = question.split(/\s+/).filter(Boolean).length;
  const questionMarkCount = (question.match(/\?/g) || []).length;

  if (question.length < 18 || question.length > 140) {
    return false;
  }

  if (wordCount < 5 || wordCount > 24) {
    return false;
  }

  if (!question.endsWith('?') || questionMarkCount !== 1) {
    return false;
  }

  if (/[.!]\s+\S/.test(question)) {
    return false;
  }

  if (hasPromptLeak(question)) {
    return false;
  }

  if (isRecentQuestion(question)) {
    return false;
  }

  return true;
}

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{16,20}$/.test(value);
}

function parseJsonObject(text) {
  if (!text) {
    return null;
  }

  if (typeof text === 'object' && !Array.isArray(text)) {
    return text;
  }

  if (typeof text !== 'string') {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makePrompt(config) {
  const recent = qotdState.recentQuestions.length
    ? qotdState.recentQuestions.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'None yet';
  const vibeLine = getQuietThemeHint(config.qotdTimezone);

  return [
    'Generate four distinct question-of-the-day candidates for a Discord server.',
    'Write them like a real person dropping a good question into chat, not like a brand prompt or a therapy worksheet.',
    'Make them conversational, specific, and easy to answer without feeling shallow.',
    'Avoid boring icebreakers, yes/no questions, fake-deep fluff, therapy-speak, and overly polished wording.',
    'Each question must be one sentence, end with a question mark, and stay under 20 words.',
    'Do not repeat or closely echo any recent questions.',
    'Order the candidates from strongest to weakest.',
    '',
    'Good style examples:',
    '- What is a tiny hill you will die on for no good reason?',
    '- What is something you were sure was true as a kid that makes no sense now?',
    '- Which job would you be weirdly good at even with zero experience?',
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
  for (let attempt = 0; attempt < MAX_QOTD_ATTEMPTS; attempt += 1) {
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
          provider: {
            require_parameters: true,
          },
          messages: [
            {
              role: 'system',
              content: 'You write natural, human-sounding question-of-the-day prompts for online communities. Return structured data only.',
            },
            {
              role: 'user',
              content: makePrompt(config),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'qotd_candidates',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  candidates: {
                    type: 'array',
                    minItems: 4,
                    maxItems: 4,
                    items: {
                      type: 'object',
                      properties: {
                        question: {
                          type: 'string',
                          description: 'A single natural-sounding question of the day.',
                        },
                      },
                      required: ['question'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['candidates'],
                additionalProperties: false,
              },
            },
          },
          plugins: [{ id: 'response-healing' }],
          temperature: 1.1,
          max_tokens: 220,
          stream: false,
        }),
      });

      if (!response.ok) {
        const problemText = await response.text().catch(() => '');
        throw new Error(`qotd api failed with status ${response.status}${problemText ? `: ${problemText}` : ''}`);
      }

      const data = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonObject(rawText);
      const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

      for (const candidate of candidates) {
        const question = cleanupQuestion(candidate?.question || '');

        if (isValidQuestion(question)) {
          return question;
        }
      }

      console.warn(`qotd api returned no valid candidates on attempt ${attempt + 1}`);
      console.warn(rawText);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('qotd api returned no valid question candidates');
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
  const postedAt = `${shortTime(nowBits.hour)}:${shortTime(nowBits.minute)} ET`;

  const embed = new EmbedBuilder()
    .setColor(0xd1a15d)
    .setTitle('QOTD')
    .setDescription(question);

  const footerText = prettyToday
    ? `${prettyToday} • ${postedAt}`
    : postedAt;

  embed.setFooter({
    text: footerText,
  });

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

  const roleId = isSnowflake(client.botConfig.qotdPingRoleId)
    ? client.botConfig.qotdPingRoleId
    : '';
  const sentMessage = await channel.send({
    content: roleId ? `<@&${roleId}>` : undefined,
    allowedMentions: roleId ? { roles: [roleId] } : undefined,
    embeds: [buildQotdEmbed(question, nowBits)],
  });

  const thread = await sentMessage.startThread({
    name: makeThreadName(question, nowBits),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: 'daily qotd discussion thread',
  });

  await thread.send('Use this thread for answers so the main channel stays readable.');
}

async function triggerQotd(client, overrides = {}) {
  const config = {
    ...client.botConfig,
    ...overrides,
  };

  if (!config.qotdChannelId) {
    throw new Error('missing qotd channel id');
  }

  if (!config.qotdApiKey) {
    throw new Error('missing qotd api key');
  }

  const nowBits = getEtTimeBits(config.qotdTimezone || 'America/New_York');
  const question = await askForQotd(config);
  const previousConfig = client.botConfig;

  try {
    client.botConfig = config;
    await sendQotd(client, question, nowBits);
  } finally {
    client.botConfig = previousConfig;
  }

  rememberQuestion(question, nowBits.dayKey);

  return {
    nowBits,
    question,
  };
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

    await triggerQotd(client, {
      qotdTimezone: config.qotdTimezone,
    });
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
  buildQotdEmbed,
  checkQotd,
  triggerQotd,
  startQotdLoop,
};
