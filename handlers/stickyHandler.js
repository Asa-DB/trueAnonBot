const stickyMsgIds = new Map();
const stickyTimes = new Map();
const chatTimes = new Map();

function findExistingSticky(recent, client) {
  return recent?.find((msg) => msg.author.id === client.user.id);
}

async function postSticky(client, stickyChannelId) {
  const stickyText = client.botConfig.stickyMessage;

  if (!stickyChannelId || !stickyText) {
    return;
  }

  const channel = await client.channels.fetch(stickyChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  const oldStickyId = stickyMsgIds.get(stickyChannelId) || null;

  if (!oldStickyId) {
    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const oldSticky = findExistingSticky(recent, client);

    if (oldSticky) {
      await oldSticky.delete().catch(() => null);
    }
  }

  if (oldStickyId) {
    const oldMsg = await channel.messages.fetch(oldStickyId).catch(() => null);

    if (oldMsg) {
      await oldMsg.delete().catch(() => null);
    }
  }

  const freshMsg = await channel.send(stickyText).catch(() => null);

  if (freshMsg) {
    stickyMsgIds.set(stickyChannelId, freshMsg.id);
    stickyTimes.set(stickyChannelId, Date.now());
  }
}

function noteStickyActivity(message) {
  if (message.author?.bot || message.guildId == null) {
    return;
  }

  if (!message.client.botConfig.stickyChannelIds?.includes(message.channelId)) {
    return;
  }

  chatTimes.set(message.channelId, Date.now());
}

function startStickyLoop(client) {
  const everyMs = client.botConfig.stickyIntervalMs;
  const stickyIds = client.botConfig.stickyChannelIds || [];

  if (!stickyIds.length || !client.botConfig.stickyMessage || !everyMs) {
    return;
  }

  setInterval(() => {
    for (const channelId of stickyIds) {
      const lastChatAt = chatTimes.get(channelId) || 0;
      const lastStickyAt = stickyTimes.get(channelId) || 0;

      if (!lastChatAt || lastChatAt <= lastStickyAt) {
        continue;
      }

      postSticky(client, channelId).catch((error) => {
        console.error('sticky post failed');
        console.error(error);
      });
    }
  }, everyMs);
}

module.exports = {
  noteStickyActivity,
  postSticky,
  startStickyLoop,
};
