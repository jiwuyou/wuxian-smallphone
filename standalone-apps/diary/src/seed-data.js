'use strict';

const seedState = Object.freeze({
  schemaVersion: 1,
  entries: Object.freeze([
    Object.freeze({
      id: 'seed-tomorrow-list',
      title: '明天事项',
      text: '10:00 交项目状态，路上买咖啡豆。',
      createdAt: '2026-05-04T09:00:00.000Z',
      updatedAt: '2026-05-04T09:00:00.000Z',
    }),
  ]),
});

function cloneSeedState() {
  return JSON.parse(JSON.stringify(seedState));
}

module.exports = {
  cloneSeedState,
  seedState,
};
