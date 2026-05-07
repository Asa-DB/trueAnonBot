const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const stateFile = path.join(dataDir, 'runtime-state.json');

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        confirmQueue: [],
        livePosts: [],
        infoRequests: [],
      }, null, 2),
    );
  }
}

function normalizeState(state) {
  if (!Array.isArray(state.confirmQueue)) {
    state.confirmQueue = [];
  }

  if (!Array.isArray(state.livePosts)) {
    state.livePosts = [];
  }

  if (!Array.isArray(state.infoRequests)) {
    state.infoRequests = [];
  }

  return state;
}

function readState() {
  ensureStateFile();
  const raw = fs.readFileSync(stateFile, 'utf8');
  return normalizeState(JSON.parse(raw));
}

function writeState(state) {
  ensureStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(normalizeState(state), null, 2));
}

function saveSubmissionState(confirmQueue, livePosts) {
  const state = readState();

  state.confirmQueue = Array.from(confirmQueue.values());
  state.livePosts = Array.from(livePosts.values());

  writeState(state);
}

function saveInfoRequestState(infoRequests) {
  const state = readState();

  state.infoRequests = Array.from(infoRequests.entries()).map(([userId, item]) => ({
    userId,
    ...item,
  }));

  writeState(state);
}

module.exports = {
  readState,
  saveInfoRequestState,
  saveSubmissionState,
};
