const crypto = require('node:crypto');

function makeSubmissionId() {
  // just needs to be unique enough
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function makeAnonId() {
  const number = crypto.randomInt(1000, 10000);
  return `anon-${number}`;
}

module.exports = {
  makeAnonId,
  makeSubmissionId,
};
