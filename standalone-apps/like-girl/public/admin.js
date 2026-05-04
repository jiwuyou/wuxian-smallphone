'use strict';

const adminState = {
  data: null,
  tab: 'site',
  editing: null,
};

const sessionStorageKey = 'likeGirl.admin.sessionId';

const collectionFields = {
  about: [
    ['title', '标题', 'input'],
    ['text', '内容', 'textarea'],
    ['imageUrl', '图片地址', 'input'],
  ],
  articles: [
    ['title', '标题', 'input'],
    ['author', '作者', 'input'],
    ['text', '摘要', 'textarea'],
    ['html', '正文 HTML / 媒体内容', 'textarea'],
    ['createdAt', '日期', 'datetime-local'],
  ],
  photos: [
    ['title', '标题', 'input'],
    ['imageUrl', '图片地址', 'input'],
    ['caption', '说明', 'textarea'],
    ['takenAt', '日期', 'datetime-local'],
  ],
  checklist: [
    ['title', '事项', 'input'],
    ['done', '已完成', 'checkbox'],
    ['imageUrl', '图片地址', 'input'],
  ],
  messages: [
    ['name', '昵称', 'input'],
    ['qq', 'QQ', 'input'],
    ['text', '留言内容', 'textarea'],
    ['createdAt', '日期', 'datetime-local'],
  ],
};

const collectionTitles = {
  about: '关于我们',
  articles: '点点滴滴',
  photos: '恋爱相册',
  checklist: '恋爱清单',
  messages: '留言管理',
};

const responseKeys = {
  about: 'about',
  articles: 'article',
  photos: 'photo',
  checklist: 'checklistItem',
  messages: 'message',
};

function normalizeAdminPayload(payload = {}) {
  const data = payload.state || {};
  return {
    profile: data.profile || {},
    messageSettings: data.messageSettings || {
      allowMessages: true,
      requireQq: false,
      latestLimit: 100,
      dailyLimitPerIp: 1,
      minLength: 3,
      maxLength: 100,
      forbiddenCharacters: '',
      blockedWords: [],
    },
    about: Array.isArray(data.about) ? data.about : [],
    articles: Array.isArray(data.articles) ? data.articles : [],
    photos: Array.isArray(data.photos) ? data.photos : [],
    checklist: Array.isArray(data.checklist) ? data.checklist : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDateInput(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function fromDateInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function toast(message) {
  document.querySelectorAll('.toast').forEach((item) => item.remove());
  document.body.insertAdjacentHTML('afterbegin', `<div class="toast">${escapeHtml(message)}</div>`);
  setTimeout(() => document.querySelector('.toast')?.remove(), 3000);
}

async function api(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
  const sessionId = window.localStorage.getItem(sessionStorageKey);
  if (sessionId) headers.authorization = `Bearer ${sessionId}`;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || '请求失败');
  return payload;
}

async function loadState() {
  const payload = await api('/api/admin/state');
  adminState.data = normalizeAdminPayload(payload);
  document.querySelector('#login-panel').hidden = true;
  document.querySelector('#admin-panel').hidden = false;
  document.querySelector('#logout-button').hidden = false;
  render();
}

function setActiveTab(tab) {
  adminState.tab = tab;
  adminState.editing = null;
  render();
}

function render() {
  if (!adminState.data) return;
  document.querySelectorAll('#admin-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === adminState.tab);
  });
  if (adminState.tab === 'site') renderSite();
  else if (adminState.tab === 'settings') renderSettings();
  else if (adminState.tab === 'account') renderAccount();
  else renderCollection(adminState.tab);
}

function renderSite() {
  const profile = adminState.data.profile || {};
  const textFields = [
    ['title', '站点标题'],
    ['logo', '站点标识'],
    ['writing', '首页文案'],
    ['boy', '男方名称'],
    ['girl', '女方名称'],
    ['startTime', '开始时间'],
    ['coverImage', '封面图片'],
    ['backgroundImage', '背景图片 / bgimg'],
    ['boyImage', '男方头像'],
    ['girlImage', '女方头像'],
    ['userName', '站长昵称'],
    ['userQQ', '站长 QQ'],
    ['icp', 'ICP'],
    ['copyright', '版权信息'],
  ];
  const cardFields = [
    ['articles', '点点滴滴卡片'],
    ['messages', '留言卡片'],
    ['about', '关于卡片'],
    ['photos', '相册卡片'],
    ['checklist', '清单卡片'],
  ];
  document.querySelector('#admin-main').innerHTML = `
    <h2>站点设置</h2>
    <form class="admin-form" id="site-form">
      ${textFields.map(([name, label]) => `
        <label>${label}<input name="${name}" value="${escapeHtml(profile[name] || '')}"></label>
      `).join('')}
      <h3 class="admin-form-heading">首页卡片</h3>
      ${cardFields.map(([name, label]) => `
        <label>${label}标题<input name="cardLabels.${name}" value="${escapeHtml(profile.cardLabels?.[name] || '')}"></label>
        <label>${label}说明<input name="cardDescriptions.${name}" value="${escapeHtml(profile.cardDescriptions?.[name] || '')}"></label>
      `).join('')}
      <h3 class="admin-form-heading">自定义</h3>
      <label>自定义 CSS<textarea name="customCss" rows="7">${escapeHtml(profile.customCss || '')}</textarea></label>
      <label>头部 HTML<textarea name="headHtml" rows="5">${escapeHtml(profile.headHtml || '')}</textarea></label>
      <label>底部 HTML<textarea name="footerHtml" rows="5">${escapeHtml(profile.footerHtml || '')}</textarea></label>
      <label class="check-label"><input type="checkbox" name="animation" ${profile.animation ? 'checked' : ''}> 启用动画</label>
      <label class="check-label"><input type="checkbox" name="pjaxEnabled" ${profile.pjaxEnabled ? 'checked' : ''}> 启用 PJAX</label>
      <label class="check-label"><input type="checkbox" name="blurEnabled" ${profile.blurEnabled ? 'checked' : ''}> 启用模糊效果</label>
      <button type="submit">保存站点设置</button>
    </form>
  `;
  document.querySelector('#site-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {};
    textFields.forEach(([name]) => {
      payload[name] = formData.get(name);
    });
    payload.cardLabels = {};
    payload.cardDescriptions = {};
    cardFields.forEach(([name]) => {
      payload.cardLabels[name] = formData.get(`cardLabels.${name}`);
      payload.cardDescriptions[name] = formData.get(`cardDescriptions.${name}`);
    });
    payload.customCss = formData.get('customCss');
    payload.headHtml = formData.get('headHtml');
    payload.footerHtml = formData.get('footerHtml');
    payload.animation = formData.has('animation');
    payload.pjaxEnabled = formData.has('pjaxEnabled');
    payload.blurEnabled = formData.has('blurEnabled');
    const response = await api('/api/admin/site', { method: 'PUT', body: JSON.stringify(payload) });
    adminState.data.profile = response.profile;
    toast('站点设置已保存。');
    render();
  });
}

function fieldValue(record, name, type) {
  if (type === 'checkbox') return record?.[name] ? 'checked' : '';
  if (type === 'datetime-local') return toDateInput(record?.[name]);
  return record?.[name] || '';
}

function renderField(record, field) {
  const [name, label, type] = field;
  if (type === 'textarea') {
    return `<label>${label}<textarea name="${name}" rows="5">${escapeHtml(fieldValue(record, name, type))}</textarea></label>`;
  }
  if (type === 'checkbox') {
    return `<label class="check-label"><input type="checkbox" name="${name}" ${fieldValue(record, name, type)}> ${label}</label>`;
  }
  return `<label>${label}<input type="${type}" name="${name}" value="${escapeHtml(fieldValue(record, name, type))}"></label>`;
}

function renderCollection(collection) {
  const rows = Array.isArray(adminState.data?.[collection]) ? adminState.data[collection] : [];
  const record = rows.find((item) => item.id === adminState.editing) || {};
  const fields = collectionFields[collection] || [];
  document.querySelector('#admin-main').innerHTML = `
    <div class="admin-section-head">
      <h2>${escapeHtml(collectionTitles[collection] || collection)}</h2>
      <button type="button" id="new-record">新建</button>
    </div>
    <form class="admin-form" id="record-form">
      <input type="hidden" name="id" value="${escapeHtml(record.id || '')}">
      ${fields.map((field) => renderField(record, field)).join('')}
      ${collection === 'photos' ? '<label>上传图片<input type="file" id="photo-upload" accept="image/*"></label>' : ''}
      <button type="submit">${record.id ? '更新' : '创建'}</button>
    </form>
    <div class="admin-list">
      ${rows.map((item) => `
        <article class="admin-row">
          <div>
            <strong>${escapeHtml(item.title || item.name || item.id)}</strong>
            <p>${escapeHtml(item.text || item.caption || item.imageUrl || '')}</p>
          </div>
          <div class="row-actions">
            <button type="button" data-edit="${escapeHtml(item.id)}">编辑</button>
            <button type="button" data-delete="${escapeHtml(item.id)}">删除</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
  document.querySelector('#new-record').addEventListener('click', () => {
    adminState.editing = null;
    render();
  });
  document.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      adminState.editing = button.dataset.edit;
      render();
    });
  });
  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/admin/${collection}/${encodeURIComponent(button.dataset.delete)}`, { method: 'DELETE' });
      adminState.data[collection] = adminState.data[collection].filter((item) => item.id !== button.dataset.delete);
      toast('已删除。');
      render();
    });
  });
  const uploadInput = document.querySelector('#photo-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', async () => {
      if (!uploadInput.files.length) return;
      const formData = new FormData();
      formData.append('file', uploadInput.files[0]);
      const response = await api('/api/admin/uploads/photos', { method: 'POST', body: formData });
      document.querySelector('input[name="imageUrl"]').value = response.upload.url;
      toast('图片已上传。');
    });
  }
  document.querySelector('#record-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    fields.forEach(([name, , type]) => {
      if (type === 'checkbox') payload[name] = formData.has(name);
      if (type === 'datetime-local') payload[name] = fromDateInput(payload[name]);
    });
    const id = payload.id;
    if (!id) delete payload.id;
    const response = await api(id ? `/api/admin/${collection}/${encodeURIComponent(id)}` : `/api/admin/${collection}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    const saved = response[responseKeys[collection]];
    const existingIndex = adminState.data[collection].findIndex((item) => item.id === saved.id);
    if (existingIndex === -1) adminState.data[collection].unshift(saved);
    else adminState.data[collection][existingIndex] = saved;
    adminState.editing = saved.id;
    toast('已保存。');
    render();
  });
}

function renderSettings() {
  const settings = adminState.data.messageSettings;
  document.querySelector('#admin-main').innerHTML = `
    <h2>留言设置</h2>
    <form class="admin-form" id="settings-form">
      <label class="check-label"><input type="checkbox" name="allowMessages" ${settings.allowMessages ? 'checked' : ''}> 允许留言</label>
      <label class="check-label"><input type="checkbox" name="requireQq" ${settings.requireQq ? 'checked' : ''}> 必填 QQ</label>
      <label>展示条数<input type="number" min="1" max="500" name="latestLimit" value="${settings.latestLimit}"></label>
      <label>每 IP 每日上限<input type="number" min="1" max="100" name="dailyLimitPerIp" value="${settings.dailyLimitPerIp}"></label>
      <label>最小长度<input type="number" min="1" max="100" name="minLength" value="${settings.minLength}"></label>
      <label>最大长度<input type="number" min="10" max="2000" name="maxLength" value="${settings.maxLength}"></label>
      <label>拦截字符<input name="forbiddenCharacters" value="${escapeHtml(settings.forbiddenCharacters || '')}"></label>
      <label>拦截词<textarea name="blockedWords" rows="4">${escapeHtml((settings.blockedWords || []).join('\\n'))}</textarea></label>
      <button type="submit">保存留言设置</button>
    </form>
  `;
  document.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    payload.allowMessages = formData.has('allowMessages');
    payload.requireQq = formData.has('requireQq');
    payload.blockedWords = String(payload.blockedWords || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    const response = await api('/api/admin/message-settings', { method: 'PUT', body: JSON.stringify(payload) });
    adminState.data.messageSettings = response.messageSettings;
    toast('留言设置已保存。');
    render();
  });
}

function renderAccount() {
  document.querySelector('#admin-main').innerHTML = `
    <h2>账号设置</h2>
    <form class="admin-form narrow" id="account-form">
      <label>用户名<input name="username" required></label>
      <label>新密码<input type="password" name="password" required></label>
      <button type="submit">修改账号</button>
    </form>
  `;
  document.querySelector('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api('/api/admin/admin', { method: 'PUT', body: JSON.stringify(payload) });
    toast('账号已修改，请重新登录。');
    document.querySelector('#login-panel').hidden = false;
    document.querySelector('#admin-panel').hidden = true;
  });
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())),
    });
    if (result?.session?.id) window.localStorage.setItem(sessionStorageKey, result.session.id);
    await loadState();
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
  window.localStorage.removeItem(sessionStorageKey);
  document.querySelector('#login-panel').hidden = false;
  document.querySelector('#admin-panel').hidden = true;
  document.querySelector('#logout-button').hidden = true;
});

document.querySelector('#admin-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (button) setActiveTab(button.dataset.tab);
});

loadState().catch(() => {
  document.querySelector('#login-panel').hidden = false;
});
