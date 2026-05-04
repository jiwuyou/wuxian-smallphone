'use strict';

const seedState = Object.freeze({
  schemaVersion: 1,
  entries: Object.freeze([
    Object.freeze({
      id: 'seed-todays-sea-breeze',
      title: '今天的海风',
      text: '和林秋聊了晚霞和夜市，明明只是普通的散步计划，却有一种把今天慢慢收起来的感觉。',
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
