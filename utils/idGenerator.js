const crypto = require('node:crypto');

function makeSubmissionId() {
  // just needs to be unique enough
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

module.exports = {
  makeSubmissionId,
};
