const { EmbedBuilder } = require('discord.js');

const palette = {
  info: 0x7aa2f7,
  success: 0x9ece6a,
  warning: 0xe0af68,
  error: 0xf7768e,
};

function joinBits(stuff) {
  if (Array.isArray(stuff)) {
    return stuff.filter(Boolean).join('\n');
  }

  return stuff || '';
}

function base(kind, title, stuff) {
  return new EmbedBuilder()
    .setColor(palette[kind] || palette.info)
    .setTitle(title)
    .setDescription(joinBits(stuff));
}

function infoBox(title, stuff) {
  return base('info', title, stuff);
}

function okEmbed(title, stuff) {
  return base('success', title, stuff);
}

function warnBox(title, stuff) {
  return base('warning', title, stuff);
}

function errEmbed(title, stuff) {
  return base('error', title, stuff);
}

module.exports = {
  errEmbed,
  infoBox,
  okEmbed,
  warnBox,
};
