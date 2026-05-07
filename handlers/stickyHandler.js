let lastStickyMessageId = null;

async function postSticky(client) {
  const stickyChannelId = client.botConfig.stickyChannelId;
  const stickyText = client.botConfig.stickyMessage;

  if (!stickyChannelId || !stickyText) {
    return;
  }

  const channel = await client.channels.fetch(stickyChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  if (!lastStickyMessageId) {
    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const oldSticky = recent?.find((msg) => msg.author.id === client.user.id && msg.content === stickyText);

    if (oldSticky) {
      await oldSticky.delete().catch(() => null);
    }
  }

  if (lastStickyMessageId) {
    const oldMsg = await channel.messages.fetch(lastStickyMessageId).catch(() => null);

    if (oldMsg) {
      await oldMsg.delete().catch(() => null);
    }
  }

  const freshMsg = await channel.send(stickyText).catch(() => null);

  if (freshMsg) {
    lastStickyMessageId = freshMsg.id;
  }
}

function startStickyLoop(client) {
  const everyMs = client.botConfig.stickyIntervalMs;

  if (!client.botConfig.stickyChannelId || !client.botConfig.stickyMessage || !everyMs) {
    return;
  }

  postSticky(client).catch((error) => {
    console.error('sticky post failed');
    console.error(error);
  });

  setInterval(() => {
    postSticky(client).catch((error) => {
      console.error('sticky post failed');
      console.error(error);
    });
  }, everyMs);
}

module.exports = {
  postSticky,
  startStickyLoop,
};
