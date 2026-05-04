'use strict';

const seedState = {
  schemaVersion: 1,
  profile: {
    boy: 'Ki',
    girl: 'Li',
    title: 'LikeGirl',
    logo: 'LikeGirl',
    writing: '喜欢花，喜欢浪漫，也喜欢把日常认真留下。',
    startTime: '2022-06-05T00:07:00.000Z',
    coverImage: '/assets/cover.svg',
    userName: 'SmallPhone',
  },
  about: [
    { id: 'welcome', title: 'Hi', text: '欢迎来到这个用 SmallPhone 重做的 LikeGirl 页面。' },
    { id: 'memory', title: '记录', text: '点滴、相册、留言和清单都存在本地 SQLite 里。' },
    { id: 'native', title: '原生', text: '这里不再运行 PHP，只保留 LikeGirl 的页面气质。' },
  ],
  articles: [
    {
      id: 'little-001',
      title: '今天也要认真记录',
      author: 'Ki',
      text: '把普通的一天写下来，它就不会轻易散掉。SmallPhone 会把这些片段存在本地。',
      createdAt: '2026-05-04T09:00:00.000Z',
    },
    {
      id: 'little-002',
      title: '海边散步',
      author: 'Li',
      text: '傍晚的风很轻，照片也很柔和，适合放进恋爱相册。',
      createdAt: '2026-05-03T19:30:00.000Z',
    },
  ],
  photos: [
    {
      id: 'photo-cover',
      title: '封面',
      imageUrl: '/assets/cover.svg',
      caption: '保留 LikeGirl 的柔和首页气质。',
      takenAt: '2026-05-04T09:00:00.000Z',
    },
    {
      id: 'photo-about',
      title: '关于我们',
      imageUrl: '/assets/about.svg',
      caption: '一个轻量的页面主题，而不是 PHP 运行时。',
      takenAt: '2026-05-03T09:00:00.000Z',
    },
  ],
  messages: [
    {
      id: 'msg-001',
      name: '访客',
      qq: '',
      text: '祝你今天也有被认真记住的小事。',
      createdAt: '2026-05-04T09:00:00.000Z',
    },
  ],
  checklist: [
    { id: 'event-001', done: true, title: '把 LikeGirl 页面迁进 SmallPhone', imageUrl: '/assets/like.svg' },
    { id: 'event-002', done: false, title: '补一组真实照片', imageUrl: '/assets/gallery.svg' },
    { id: 'event-003', done: false, title: '写下第一条留言', imageUrl: '/assets/message.svg' },
  ],
};

function cloneSeedState() {
  return JSON.parse(JSON.stringify(seedState));
}

module.exports = {
  cloneSeedState,
  seedState,
};
