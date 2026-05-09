const { checkDeadThreads, startDeadThreadLoop } = require('../handlers/threadHandler');
const { checkLatestNewsletter, startNewsletterLoop } = require('../handlers/newsletterHandler');
const { checkQotd, startQotdLoop } = require('../handlers/qotdHandler');
const { startStickyLoop } = require('../handlers/stickyHandler');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    console.log(`logged in as ${client.user.tag}`);
    await checkDeadThreads(client);
    await checkLatestNewsletter(client);
    await checkQotd(client);
    startDeadThreadLoop(client);
    startNewsletterLoop(client);
    startQotdLoop(client);
    startStickyLoop(client);
  },
};
