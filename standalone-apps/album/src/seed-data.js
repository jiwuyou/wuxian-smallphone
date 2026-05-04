'use strict';

const seedState = Object.freeze({
  schemaVersion: 1,
  albums: Object.freeze([
    Object.freeze({
      id: 'seed-weekend-walks',
      title: 'Weekend Walks',
      description: 'Reference images collected during neighborhood walks.',
      createdAt: '2026-05-04T09:00:00.000Z',
      updatedAt: '2026-05-04T09:00:00.000Z',
    }),
  ]),
  photos: Object.freeze([
    Object.freeze({
      id: 'seed-corner-light',
      title: 'Corner light',
      albumId: 'seed-weekend-walks',
      imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
      caption: 'Late afternoon light across a quiet corner.',
      takenAt: '2026-05-03T17:30:00.000Z',
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
