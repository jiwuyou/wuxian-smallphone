'use strict';

const collectionNames = new Set(['about', 'articles', 'photos', 'checklist', 'messages']);
const defaultForbiddenCharacters = '`~@#$^*=|{}[]<>';

class LikeGirlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LikeGirlValidationError';
    this.statusCode = 400;
    this.code = 'LIKE_GIRL_VALIDATION_ERROR';
  }
}

class LikeGirlNotFoundError extends Error {
  constructor(id) {
    super(`记录不存在：${id}`);
    this.name = 'LikeGirlNotFoundError';
    this.statusCode = 404;
    this.code = 'LIKE_GIRL_NOT_FOUND';
  }
}

class LikeGirlAuthError extends Error {
  constructor(message = '请先登录。') {
    super(message);
    this.name = 'LikeGirlAuthError';
    this.statusCode = 401;
    this.code = 'LIKE_GIRL_AUTH_REQUIRED';
  }
}

class LikeGirlForbiddenError extends Error {
  constructor(message = '当前操作不允许。') {
    super(message);
    this.name = 'LikeGirlForbiddenError';
    this.statusCode = 403;
    this.code = 'LIKE_GIRL_FORBIDDEN';
  }
}

function normalizeText(value, label, maxLength, required = true) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new LikeGirlValidationError(`${label}不能为空。`);
  if (text.length > maxLength) throw new LikeGirlValidationError(`${label}不能超过 ${maxLength} 个字符。`);
  return text;
}

function normalizeDate(value, fallback) {
  const candidate = String(value || fallback || new Date().toISOString()).trim();
  const time = Date.parse(candidate);
  return Number.isNaN(time) ? new Date().toISOString() : new Date(time).toISOString();
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fallbackSummary(value, maxLength = 240) {
  const text = stripHtml(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeProfile(profile = {}) {
  const cardLabels = profile.cardLabels || {};
  const cardDescriptions = profile.cardDescriptions || {};
  const diy = profile.diy || {};
  const backgroundImage = profile.backgroundImage || profile.bgimg || profile.coverImage || '/assets/cover.svg';
  return {
    boy: normalizeText(profile.boy || 'Ki', '男方名称', 40),
    girl: normalizeText(profile.girl || 'Li', '女方名称', 40),
    title: normalizeText(profile.title || 'LikeGirl', '站点标题', 80),
    logo: normalizeText(profile.logo || profile.title || 'LikeGirl', '站点标识', 80),
    writing: normalizeText(profile.writing || '', '首页文案', 300, false),
    startTime: normalizeDate(profile.startTime, '2022-06-05T00:07:00.000Z'),
    coverImage: normalizeText(profile.coverImage || backgroundImage, '封面图片', 1000, false),
    backgroundImage: normalizeText(backgroundImage, '背景图片', 1000, false),
    bgimg: normalizeText(backgroundImage, '背景图片', 1000, false),
    boyImage: normalizeText(profile.boyImage || profile.boyimg || '', '男方头像', 1000, false),
    girlImage: normalizeText(profile.girlImage || profile.girlimg || '', '女方头像', 1000, false),
    userName: normalizeText(profile.userName || 'SmallPhone', '站长昵称', 80),
    userQQ: normalizeText(profile.userQQ || '', '站长 QQ', 40, false),
    copyright: normalizeText(profile.copyright || profile.Copyright || '', '版权信息', 200, false),
    icp: normalizeText(profile.icp || '', 'ICP', 80, false),
    animation: Boolean(profile.animation ?? profile.Animation ?? true),
    cardLabels: {
      articles: normalizeText(cardLabels.articles || profile.card1 || '点点滴滴', '点滴卡片标题', 80),
      messages: normalizeText(cardLabels.messages || profile.card2 || '留言板', '留言卡片标题', 80),
      about: normalizeText(cardLabels.about || profile.card3 || '关于我们', '关于卡片标题', 80),
      photos: normalizeText(cardLabels.photos || '恋爱相册', '相册卡片标题', 80),
      checklist: normalizeText(cardLabels.checklist || '恋爱清单', '清单卡片标题', 80),
    },
    cardDescriptions: {
      articles: normalizeText(cardDescriptions.articles || profile.deci1 || '有人愿意听你碎碎念念也很浪漫', '点滴卡片说明', 200, false),
      messages: normalizeText(cardDescriptions.messages || profile.deci2 || '在这里写下我们的留言祝福', '留言卡片说明', 200, false),
      about: normalizeText(cardDescriptions.about || profile.deci3 || '我们之间认识的经历回忆', '关于卡片说明', 200, false),
      photos: normalizeText(cardDescriptions.photos || '记录下你的最美瞬间', '相册卡片说明', 200, false),
      checklist: normalizeText(cardDescriptions.checklist || '一起完成想做的事', '清单卡片说明', 200, false),
    },
    customCss: normalizeText(profile.customCss || diy.customCss || profile.cssCon || '', '自定义 CSS', 20000, false),
    headHtml: normalizeText(profile.headHtml || diy.headHtml || profile.headCon || '', '头部 HTML', 20000, false),
    footerHtml: normalizeText(profile.footerHtml || diy.footerHtml || profile.footerCon || '', '底部 HTML', 20000, false),
    pjaxEnabled: Boolean(profile.pjaxEnabled ?? diy.pjaxEnabled ?? profile.Pjaxkg === '1' ?? false),
    blurEnabled: Boolean(profile.blurEnabled ?? diy.blurEnabled ?? profile.Blurkg === '1' ?? false),
  };
}

function normalizeMessageSettings(settings = {}) {
  const blockedWords = Array.isArray(settings.blockedWords)
    ? settings.blockedWords.map((item) => String(item).trim()).filter(Boolean).slice(0, 100)
    : String(settings.blockedWords || settings.lanjiezf || '操 垃圾 傻逼 妈').split(/\s+/).filter(Boolean);
  return {
    allowMessages: settings.allowMessages !== false,
    latestLimit: normalizeInteger(settings.latestLimit ?? settings.jiequ, 100, 1, 500),
    dailyLimitPerIp: normalizeInteger(settings.dailyLimitPerIp, 1, 1, 100),
    minLength: normalizeInteger(settings.minLength, 3, 1, 100),
    maxLength: normalizeInteger(settings.maxLength, 100, 10, 2000),
    requireQq: Boolean(settings.requireQq),
    forbiddenCharacters: normalizeText(
      settings.forbiddenCharacters ?? settings.lanjie ?? defaultForbiddenCharacters,
      '拦截字符',
      1000,
      false,
    ),
    blockedWords,
  };
}

function normalizeAboutItem(item = {}, context = {}) {
  return {
    id: String(item.id || context.id),
    title: normalizeText(item.title || '关于', '关于标题', 120),
    text: normalizeText(item.text || item.info1 || '', '关于内容', 4000),
    imageUrl: normalizeText(item.imageUrl || item.aboutimg || '', '关于图片', 1000, false),
  };
}

function normalizeArticle(item = {}, context = {}) {
  const html = normalizeText(item.html ?? item.articletext ?? item.text ?? '', '文章 HTML', 30000);
  const text = normalizeText(item.text || fallbackSummary(html), '文章摘要', 2000, false);
  return {
    id: String(item.id || context.id),
    title: normalizeText(item.title || item.articletitle || '', '文章标题', 160),
    author: normalizeText(item.author || item.articlename || '', '文章作者', 80, false),
    text,
    html,
    createdAt: normalizeDate(item.createdAt || item.articletime, context.now),
  };
}

function normalizePhoto(item = {}, context = {}) {
  const imageUrl = item.imageUrl || item.imgUrl || item.url;
  return {
    id: String(item.id || context.id),
    title: normalizeText(item.title || '', '照片标题', 120, false),
    imageUrl: normalizeText(imageUrl || '', '照片图片', 1000),
    caption: normalizeText(item.caption || item.imgText || '', '照片说明', 1000, false),
    takenAt: normalizeDate(item.takenAt || item.imgDatd, context.now),
  };
}

function normalizeMessage(item = {}, context = {}) {
  return {
    id: String(item.id || context.id),
    name: normalizeText(item.name || '访客', '昵称', 40),
    qq: normalizeText(item.qq || item.QQ || '', 'QQ', 40, false),
    text: normalizeText(item.text || '', '留言内容', context.maxLength || 2000),
    createdAt: normalizeDate(item.createdAt || item.time, context.now),
    ip: normalizeText(item.ip || context.ip || '', 'IP', 80, false),
    city: normalizeText(item.city || '', '城市', 120, false),
  };
}

function normalizeChecklistItem(item = {}, context = {}) {
  return {
    id: String(item.id || context.id),
    done: Boolean(item.done ?? item.icon),
    title: normalizeText(item.title || item.eventname || '', '清单事项', 240),
    imageUrl: normalizeText(item.imageUrl || item.imgurl || '', '清单图片', 1000, false),
  };
}

function normalizeCollectionRecord(collection, input, context = {}) {
  if (!collectionNames.has(collection)) throw new LikeGirlNotFoundError(collection);
  if (collection === 'about') return normalizeAboutItem(input, context);
  if (collection === 'articles') return normalizeArticle(input, context);
  if (collection === 'photos') return normalizePhoto(input, context);
  if (collection === 'messages') return normalizeMessage(input, context);
  return normalizeChecklistItem(input, context);
}

function normalizeState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 2,
    profile: normalizeProfile(source.profile),
    messageSettings: normalizeMessageSettings(source.messageSettings),
    about: Array.isArray(source.about) ? source.about.filter((item) => item?.id && (item?.text || item?.info1)).map((item) => normalizeAboutItem(item)) : [],
    articles: Array.isArray(source.articles) ? source.articles.filter((item) => item?.id && (item?.title || item?.articletitle)).map((item) => normalizeArticle(item)) : [],
    photos: Array.isArray(source.photos) ? source.photos.filter((item) => item?.id && (item?.imageUrl || item?.imgUrl)).map((item) => normalizePhoto(item)) : [],
    messages: Array.isArray(source.messages) ? source.messages.filter((item) => item?.id && item?.text).map((item) => normalizeMessage(item)) : [],
    checklist: Array.isArray(source.checklist) ? source.checklist.filter((item) => item?.id && (item?.title || item?.eventname)).map((item) => normalizeChecklistItem(item)) : [],
  };
}

function sortByDateDesc(rows, field) {
  return rows.slice().sort((a, b) => Date.parse(b[field]) - Date.parse(a[field]));
}

function listArticles(state) {
  return sortByDateDesc(normalizeState(state).articles, 'createdAt');
}

function getArticle(state, id) {
  const article = normalizeState(state).articles.find((item) => item.id === id);
  if (!article) throw new LikeGirlNotFoundError(id);
  return clone(article);
}

function getCollectionRecord(state, collection, id) {
  if (!collectionNames.has(collection)) throw new LikeGirlNotFoundError(collection);
  const record = normalizeState(state)[collection].find((item) => item.id === id);
  if (!record) throw new LikeGirlNotFoundError(id);
  return clone(record);
}

function rejectFilteredText(text, settings) {
  if (/^\d+$/.test(text) || /(http|https):\/\//i.test(text)) {
    throw new LikeGirlValidationError('留言内容疑似垃圾信息。');
  }
  const forbidden = new Set(String(settings.forbiddenCharacters || '').split(''));
  const found = String(text).split('').find((char) => forbidden.has(char));
  if (found) throw new LikeGirlValidationError('留言包含被拦截字符。');
  const lower = String(text).toLowerCase();
  const blocked = settings.blockedWords.find((word) => word && lower.includes(String(word).toLowerCase()));
  if (blocked) throw new LikeGirlValidationError('留言包含被拦截词。');
}

function createMessage(state, input, context = {}) {
  if (!state.messages) state.messages = [];
  const settings = normalizeMessageSettings(context.settings || state.messageSettings);
  if (!settings.allowMessages) throw new LikeGirlForbiddenError('留言功能已关闭。');
  const name = normalizeText(input?.name || '访客', '昵称', 40);
  const text = normalizeText(input?.text, '留言内容', settings.maxLength);
  if (text.length < settings.minLength) {
    throw new LikeGirlValidationError(`留言至少需要 ${settings.minLength} 个字符。`);
  }
  const qq = normalizeText(input?.qq || '', 'QQ', 40, settings.requireQq);
  if (qq && !/^[1-9][0-9]{4,11}$/.test(qq)) throw new LikeGirlValidationError('QQ 必须是有效号码。');
  rejectFilteredText(text, settings);
  const message = normalizeMessage({
    id: context.id,
    name,
    qq,
    text,
    createdAt: context.now,
    ip: context.ip,
    city: context.city,
  }, { id: context.id, now: context.now, ip: context.ip, maxLength: settings.maxLength });
  state.messages.unshift(message);
  return clone(message);
}

function replaceCollectionRecord(state, collection, input, context = {}) {
  if (!collectionNames.has(collection)) throw new LikeGirlNotFoundError(collection);
  if (!state[collection]) state[collection] = [];
  const record = normalizeCollectionRecord(collection, input, context);
  const index = state[collection].findIndex((item) => item.id === record.id);
  if (index === -1) state[collection].unshift(record);
  else state[collection][index] = record;
  return clone(record);
}

function patchCollectionRecord(state, collection, id, patch, context = {}) {
  if (!collectionNames.has(collection)) throw new LikeGirlNotFoundError(collection);
  if (!state[collection]) state[collection] = [];
  const index = state[collection].findIndex((item) => item.id === id);
  if (index === -1) throw new LikeGirlNotFoundError(id);
  const record = normalizeCollectionRecord(collection, {
    ...state[collection][index],
    ...patch,
    id,
  }, context);
  state[collection][index] = record;
  return clone(record);
}

function deleteCollectionRecord(state, collection, id) {
  if (!collectionNames.has(collection)) throw new LikeGirlNotFoundError(collection);
  if (!state[collection]) state[collection] = [];
  const index = state[collection].findIndex((item) => item.id === id);
  if (index === -1) throw new LikeGirlNotFoundError(id);
  const [record] = state[collection].splice(index, 1);
  return clone(record);
}

function bootstrap(state) {
  const normalized = normalizeState(state);
  return {
    profile: normalized.profile,
    about: normalized.about,
    articles: listArticles(normalized),
    photos: sortByDateDesc(normalized.photos, 'takenAt'),
    messages: sortByDateDesc(normalized.messages, 'createdAt').slice(0, normalized.messageSettings.latestLimit),
    messageSettings: {
      latestLimit: normalized.messageSettings.latestLimit,
      allowMessages: normalized.messageSettings.allowMessages,
      requireQq: normalized.messageSettings.requireQq,
      minLength: normalized.messageSettings.minLength,
      maxLength: normalized.messageSettings.maxLength,
    },
    checklist: normalized.checklist,
  };
}

module.exports = {
  LikeGirlAuthError,
  LikeGirlForbiddenError,
  LikeGirlNotFoundError,
  LikeGirlValidationError,
  bootstrap,
  clone,
  createMessage,
  deleteCollectionRecord,
  getArticle,
  getCollectionRecord,
  listArticles,
  normalizeMessageSettings,
  normalizeProfile,
  normalizeState,
  patchCollectionRecord,
  replaceCollectionRecord,
};
