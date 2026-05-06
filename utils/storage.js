const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const storageFile = path.join(dataDir, 'submissions.json');

function ensureStorageFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(storageFile)) {
    fs.writeFileSync(
      storageFile,
      JSON.stringify({ anonIdMap: [], submissions: [] }, null, 2),
    );
  }
}

function normalizeStore(store) {
  if (!Array.isArray(store.anonIdMap)) {
    store.anonIdMap = [];
  }

  if (!Array.isArray(store.submissions)) {
    store.submissions = [];
  }

  return store;
}

function readStore() {
  ensureStorageFile();
  const raw = fs.readFileSync(storageFile, 'utf8');
  return normalizeStore(JSON.parse(raw));
}

function writeStore(store) {
  ensureStorageFile();
  fs.writeFileSync(storageFile, JSON.stringify(normalizeStore(store), null, 2));
}

function getUserAnonId(guildId, userId) {
  const store = readStore();
  const item = store.anonIdMap.find((entry) => entry.guildId === guildId && entry.userId === userId);
  return item?.anonId || null;
}

function anonIdExistsInGuild(guildId, anonId) {
  const store = readStore();
  return store.anonIdMap.some((entry) => entry.guildId === guildId && entry.anonId === anonId);
}

function saveUserAnonId(guildId, userId, anonId) {
  const store = readStore();
  const existing = store.anonIdMap.find((entry) => entry.guildId === guildId && entry.userId === userId);

  if (existing) {
    existing.anonId = anonId;
  } else {
    store.anonIdMap.push({ guildId, userId, anonId });
  }

  writeStore(store);
  return anonId;
}

function addSubmission(submission) {
  const store = readStore();
  store.submissions.push(submission);
  writeStore(store);
  return submission;
}

function getSubmissionById(submissionId) {
  const store = readStore();
  return store.submissions.find((item) => item.submissionId === submissionId) || null;
}

function getSubmissionByThreadId(threadId) {
  const store = readStore();
  return store.submissions.find((item) => item.threadId === threadId) || null;
}

function getAllSubmissions() {
  const store = readStore();
  return store.submissions;
}

function updateSubmission(submissionId, updates) {
  const store = readStore();
  const submission = store.submissions.find((item) => item.submissionId === submissionId);

  if (!submission) {
    return null;
  }

  Object.assign(submission, updates);
  writeStore(store);
  return submission;
}

function findSubmissionsByAnon(guildId, anonId) {
  const store = readStore();

  // grab all posts from this anon id lol
  return store.submissions.filter((item) => item.guildId === guildId && item.anonId === anonId);
}

module.exports = {
  anonIdExistsInGuild,
  addSubmission,
  findSubmissionsByAnon,
  getAllSubmissions,
  getSubmissionById,
  getSubmissionByThreadId,
  getUserAnonId,
  saveUserAnonId,
  updateSubmission,
};
