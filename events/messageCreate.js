const { handleMoreInfoDmReply, noteThreadStuff } = require('../handlers/threadHandler');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      await handleMoreInfoDmReply(message);
      noteThreadStuff(message);
    } catch (error) {
      console.error('message handler failed');
      console.error(error);
    }
  },
};
