const { handleMoreInfoDmReply, noteThreadStuff } = require('../handlers/threadHandler');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      noteThreadStuff(message);
      await handleMoreInfoDmReply(message);
    } catch (error) {
      console.error('message handler failed');
      console.error(error);
    }
  },
};
