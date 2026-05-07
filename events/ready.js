const { checkDeadThreads, startDeadThreadLoop } = require('../handlers/threadHandler');
const { startStickyLoop } = require('../handlers/stickyHandler');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    console.log(`logged in as ${client.user.tag}`);
    await checkDeadThreads(client);
    startDeadThreadLoop(client);
    startStickyLoop(client);
  },
};
