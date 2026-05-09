const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const runtimeStore = require('../utils/runtimeStore');

const DEFAULT_NEWS_PAGE = 'https://www.ytech.edu/news';
const DEFAULT_NEWSLETTER_PREFIX = 'Spartan Review';
const DEFAULT_POLL_MINUTES = 30;
const REQUEST_TIMEOUT_MS = 15_000;
const NEWS_ARTICLE_LINK_RE = /https:\/\/www\.ytech\.edu\/news\/[0-9a-f-]{36}|\/news\/[0-9a-f-]{36}/gi;
const SPARTAN_REVIEW_URL = 'https://www.ytech.edu/spartan-review';

const savedState = runtimeStore.readState();
const newsletterCache = {
  lastPostedUrl: savedState.newsletterState?.lastPostedUrl || null,
};

function saveNewsletterCache() {
  runtimeStore.saveNewsletterState(newsletterCache);
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanHtml(text) {
  return decodeHtml(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cutOff(text, limit = 320) {
  if (!text || text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function toFullNewsUrl(rawUrl) {
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  return `https://www.ytech.edu${rawUrl}`;
}

async function fetchPageText(url) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'true-anon-bot newsletter watcher',
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function findArticleUrls(pageHtml) {
  const seenUrls = new Set();
  const orderedUrls = [];
  const matches = pageHtml.match(NEWS_ARTICLE_LINK_RE) || [];

  for (const match of matches) {
    const articleUrl = toFullNewsUrl(match);

    if (seenUrls.has(articleUrl)) {
      continue;
    }

    seenUrls.add(articleUrl);
    orderedUrls.push(articleUrl);
  }

  return orderedUrls;
}

function getMetaContent(pageHtml, key) {
  const propertyMatch = new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i').exec(pageHtml);

  if (propertyMatch) {
    return decodeHtml(propertyMatch[1]).trim();
  }

  const nameMatch = new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i').exec(pageHtml);

  if (nameMatch) {
    return decodeHtml(nameMatch[1]).trim();
  }

  return '';
}

function getArticleTitle(pageHtml) {
  const openGraphTitle = getMetaContent(pageHtml, 'og:title');

  if (openGraphTitle) {
    return openGraphTitle;
  }

  const headingMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(pageHtml);

  if (headingMatch) {
    return cleanHtml(headingMatch[1]);
  }

  const titleTagMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(pageHtml);

  if (titleTagMatch) {
    return cleanHtml(titleTagMatch[1]).replace(/\s*\|\s*York Tech Spartans\s*$/i, '');
  }

  return '';
}

function getArticleSummary(pageHtml) {
  const metaDescription = getMetaContent(pageHtml, 'description') || getMetaContent(pageHtml, 'og:description');

  if (metaDescription) {
    return cutOff(metaDescription);
  }

  const summaryParts = [];
  const paragraphMatches = pageHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);

  for (const match of paragraphMatches) {
    const paragraphText = cleanHtml(match[1]);

    if (!paragraphText) {
      continue;
    }

    if (/sign up to receive/i.test(paragraphText)) {
      continue;
    }

    summaryParts.push(paragraphText);

    if (summaryParts.length === 2) {
      break;
    }
  }

  return cutOff(summaryParts.join(' '));
}

function getPublishedDate(pageHtml) {
  const schemaMatch = /"datePublished":"([^"]+)"/i.exec(pageHtml);

  if (schemaMatch) {
    return schemaMatch[1];
  }

  return '';
}

function formatDateLabel(rawPublishedAt) {
  if (!rawPublishedAt) {
    return '';
  }

  const publishedDate = new Date(rawPublishedAt);

  if (Number.isNaN(publishedDate.getTime())) {
    return rawPublishedAt;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(publishedDate);
}

async function readNewsletterPost(articleUrl, titlePrefix) {
  const articleHtml = await fetchPageText(articleUrl);
  const articleTitle = getArticleTitle(articleHtml);

  if (!articleTitle || !articleTitle.startsWith(titlePrefix)) {
    return null;
  }

  return {
    url: articleUrl,
    title: articleTitle,
    summary: getArticleSummary(articleHtml),
    publishedAt: getPublishedDate(articleHtml),
  };
}

async function findNewestNewsletter(config) {
  const newsPageHtml = await fetchPageText(config.newsletterSourceUrl);
  const articleUrls = findArticleUrls(newsPageHtml);

  for (const articleUrl of articleUrls) {
    const newsletterArticle = await readNewsletterPost(articleUrl, config.newsletterTitlePrefix);

    if (newsletterArticle) {
      return newsletterArticle;
    }
  }

  return null;
}

function buildNewsletterEmbed(newsletterArticle) {
  const embed = new EmbedBuilder()
    .setColor(0x7aa2f7)
    .setAuthor({
      name: 'York Tech Spartan Review',
      url: SPARTAN_REVIEW_URL,
    })
    .setTitle(newsletterArticle.title)
    .setURL(newsletterArticle.url)
    .setDescription(newsletterArticle.summary || 'A new Spartan Review issue is live.')
    .addFields(
      {
        name: 'Read Online',
        value: `[Open the newsletter](${newsletterArticle.url})`,
        inline: true,
      },
      {
        name: 'Series Page',
        value: `[Spartan Review](${SPARTAN_REVIEW_URL})`,
        inline: true,
      },
    )
    .setFooter({
      text: 'Posted automatically by true anon bot',
    });

  const publishedLabel = formatDateLabel(newsletterArticle.publishedAt);

  if (publishedLabel) {
    embed.addFields({
      name: 'Published',
      value: publishedLabel,
      inline: true,
    });
  }

  if (newsletterArticle.publishedAt) {
    const publishedDate = new Date(newsletterArticle.publishedAt);

    if (!Number.isNaN(publishedDate.getTime())) {
      embed.setTimestamp(publishedDate);
    }
  }

  return embed;
}

function buildNewsletterButtons(newsletterArticle) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open Newsletter')
      .setStyle(ButtonStyle.Link)
      .setURL(newsletterArticle.url),
    new ButtonBuilder()
      .setLabel('Spartan Review Page')
      .setStyle(ButtonStyle.Link)
      .setURL(SPARTAN_REVIEW_URL),
  );
}

async function postNewsletter(client, newsletterArticle) {
  const targetChannel = await client.channels.fetch(client.botConfig.newsletterChannelId).catch(() => null);

  if (!targetChannel || !targetChannel.isTextBased()) {
    throw new Error('newsletter channel is missing or not text-based');
  }

  const roleId = client.botConfig.newsletterPingRoleId;
  const roleMention = roleId ? `<@&${roleId}>` : '';
  const messageText = roleMention
    ? `${roleMention} New ${client.botConfig.newsletterTitlePrefix} issue posted.`
    : `New ${client.botConfig.newsletterTitlePrefix} issue posted.`;

  await targetChannel.send({
    content: messageText,
    allowedMentions: roleMention
      ? { roles: [roleId] }
      : undefined,
    embeds: [buildNewsletterEmbed(newsletterArticle)],
    components: [buildNewsletterButtons(newsletterArticle)],
  });
}

async function checkLatestNewsletter(client) {
  const config = client.botConfig;

  if (!config.newsletterChannelId) {
    return;
  }

  const latestNewsletter = await findNewestNewsletter(config);

  if (!latestNewsletter) {
    return;
  }

  if (!newsletterCache.lastPostedUrl) {
    newsletterCache.lastPostedUrl = latestNewsletter.url;
    saveNewsletterCache();
    return;
  }

  if (newsletterCache.lastPostedUrl === latestNewsletter.url) {
    return;
  }

  await postNewsletter(client, latestNewsletter);
  newsletterCache.lastPostedUrl = latestNewsletter.url;
  saveNewsletterCache();
}

function startNewsletterLoop(client) {
  if (!client.botConfig.newsletterChannelId) {
    return;
  }

  setInterval(() => {
    checkLatestNewsletter(client).catch((error) => {
      console.error('newsletter check failed');
      console.error(error);
    });
  }, client.botConfig.newsletterPollMs || DEFAULT_POLL_MINUTES * 60 * 1000);
}

module.exports = {
  checkLatestNewsletter,
  DEFAULT_NEWS_PAGE,
  DEFAULT_NEWSLETTER_PREFIX,
  DEFAULT_POLL_MINUTES,
  startNewsletterLoop,
};
