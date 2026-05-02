const DEFAULT_CHARACTER_ID = "char-aki";
const DEFAULT_CONTACT_ID = "contact-aki";
const DEFAULT_THREAD_ID = "thread-aki";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  DEFAULT_CHARACTER_ID,
  DEFAULT_CONTACT_ID,
  DEFAULT_THREAD_ID,
  createId,
  nowIso,
};

