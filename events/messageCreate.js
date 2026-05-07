const { handleDirectMessage, noteThreadStuff } = require('../handlers/threadHandler');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      await handleDirectMessage(message);
      noteThreadStuff(message);
    } catch (error) {
      console.error('message handler failed');
      console.error(error);
    }
  },
};
