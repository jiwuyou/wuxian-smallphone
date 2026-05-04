'use strict';

const state = {
  bootstrap: null,
  headHtml: '',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(path, init) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || '请求失败');
  return payload;
}

function daysSince(value) {
  const start = Date.parse(value);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

function setOptionalImage(selector, url) {
  const image = document.querySelector(selector);
  if (!url) {
    image.hidden = true;
    image.removeAttribute('src');
    return;
  }
  image.src = url;
  image.hidden = false;
}

function applyAdminHtml(profile) {
  document.querySelector('#like-girl-custom-css')?.remove();
  if (profile.customCss) {
    const style = document.createElement('style');
    style.id = 'like-girl-custom-css';
    style.textContent = profile.customCss;
    document.head.append(style);
  }
  if (profile.headHtml !== state.headHtml) {
    document.querySelectorAll('[data-like-girl-head]').forEach((node) => node.remove());
    if (profile.headHtml) {
      const template = document.createElement('template');
      template.innerHTML = profile.headHtml;
      [...template.content.childNodes].forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          node.setAttribute('data-like-girl-head', '');
          document.head.append(node);
        }
      });
    }
    state.headHtml = profile.headHtml || '';
  }
  document.querySelector('#site-footer').innerHTML = profile.footerHtml || [
    profile.icp ? `<span>${escapeHtml(profile.icp)}</span>` : '',
    profile.copyright ? `<span>${escapeHtml(profile.copyright)}</span>` : '',
  ].filter(Boolean).join('');
}

function articleIdFromPath() {
  const match = window.location.pathname.match(/^\/articles\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function trustedArticleHtml(article) {
  return String(article.html || `<p>${escapeHtml(article.text)}</p>`);
}

function normalizeBootstrapPayload(data = {}) {
  const profile = data.profile || {};
  const cardLabels = profile.cardLabels || {};
  const cardDescriptions = profile.cardDescriptions || {};
  return {
    profile: {
      title: profile.title || 'LikeGirl',
      writing: profile.writing || '',
      boy: profile.boy || '',
      girl: profile.girl || '',
      startTime: profile.startTime || new Date().toISOString(),
      coverImage: profile.coverImage || '/assets/cover.svg',
      backgroundImage: profile.backgroundImage || profile.coverImage || '/assets/cover.svg',
      boyImage: profile.boyImage || '',
      girlImage: profile.girlImage || '',
      blurEnabled: Boolean(profile.blurEnabled),
      customCss: profile.customCss || '',
      headHtml: profile.headHtml || '',
      footerHtml: profile.footerHtml || '',
      icp: profile.icp || '',
      copyright: profile.copyright || '',
      cardLabels: {
        articles: cardLabels.articles || '点点滴滴',
        messages: cardLabels.messages || '留言板',
        about: cardLabels.about || '关于我们',
        photos: cardLabels.photos || '恋爱相册',
        checklist: cardLabels.checklist || '恋爱清单',
      },
      cardDescriptions: {
        articles: cardDescriptions.articles || '',
        messages: cardDescriptions.messages || '',
        about: cardDescriptions.about || '',
        photos: cardDescriptions.photos || '',
        checklist: cardDescriptions.checklist || '',
      },
    },
    articles: Array.isArray(data.articles) ? data.articles : [],
    photos: Array.isArray(data.photos) ? data.photos : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
    checklist: Array.isArray(data.checklist) ? data.checklist : [],
    about: Array.isArray(data.about) ? data.about : [],
  };
}

async function renderArticleDetail(id) {
  const detail = document.querySelector('#article-detail');
  const list = document.querySelector('#articles');
  if (!id) {
    detail.hidden = true;
    detail.innerHTML = '';
    list.hidden = false;
    return;
  }
  const { article } = await api(`/api/articles/${encodeURIComponent(id)}`);
  list.hidden = true;
  detail.hidden = false;
  detail.innerHTML = `
    <a class="article-back" href="/#little">返回点点滴滴</a>
    <span>${escapeHtml(new Date(article.createdAt).toLocaleDateString())}</span>
    <h3>${escapeHtml(article.title)}</h3>
    <div class="article-html">${trustedArticleHtml(article)}</div>
  `;
}

function render(data) {
  data = normalizeBootstrapPayload(data);
  state.bootstrap = data;
  applyAdminHtml(data.profile);
  document.querySelector('#site-title').textContent = data.profile.title;
  document.querySelector('#site-writing').textContent = data.profile.writing;
  document.querySelector('#boy').textContent = data.profile.boy;
  document.querySelector('#girl').textContent = data.profile.girl;
  setOptionalImage('#boy-image', data.profile.boyImage);
  setOptionalImage('#girl-image', data.profile.girlImage);
  document.querySelector('#counter').textContent = `已经一起记录 ${daysSince(data.profile.startTime)} 天`;
  document.body.classList.toggle('blur-enabled', Boolean(data.profile.blurEnabled));

  const backgroundImage = data.profile.backgroundImage || data.profile.coverImage;
  document.querySelector('.hero').style.backgroundImage = `linear-gradient(90deg, rgba(20, 16, 22, .74), rgba(20, 16, 22, .18)), url("${backgroundImage}")`;

  document.querySelector('#articles-title').textContent = data.profile.cardLabels.articles;
  document.querySelector('#messages-title').textContent = data.profile.cardLabels.messages;
  document.querySelector('#about-title').textContent = data.profile.cardLabels.about;
  document.querySelector('#photos-title').textContent = data.profile.cardLabels.photos;
  document.querySelector('#checklist-title').textContent = data.profile.cardLabels.checklist;
  document.querySelector('#articles-description').textContent = data.profile.cardDescriptions.articles;
  document.querySelector('#messages-description').textContent = data.profile.cardDescriptions.messages;
  document.querySelector('#about-description').textContent = data.profile.cardDescriptions.about;
  document.querySelector('#photos-description').textContent = data.profile.cardDescriptions.photos;
  document.querySelector('#checklist-description').textContent = data.profile.cardDescriptions.checklist;

  document.querySelector('#articles').innerHTML = data.articles.map((item) => `
    <article class="article-row">
      <span>${escapeHtml(new Date(item.createdAt).toLocaleDateString())}</span>
      <h3><a href="/articles/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join('');

  document.querySelector('#photo-grid').innerHTML = data.photos.map((photo) => `
    <figure class="photo-item">
      <img src="${escapeHtml(photo.imageUrl)}" alt="">
      <figcaption>
        <strong>${escapeHtml(photo.title)}</strong>
        <span>${escapeHtml(photo.caption)}</span>
      </figcaption>
    </figure>
  `).join('');

  document.querySelector('#message-list').innerHTML = data.messages.map((message) => `
    <article class="message">
      <strong>${escapeHtml(message.name)}</strong>
      <p>${escapeHtml(message.text)}</p>
      <span>${escapeHtml(new Date(message.createdAt).toLocaleString())}</span>
    </article>
  `).join('');

  document.querySelector('#check-list').innerHTML = data.checklist.map((item) => `
    <div class="check-item ${item.done ? 'done' : ''}">
      <span>${item.done ? '✓' : '·'}</span>
      <strong>${escapeHtml(item.title)}</strong>
    </div>
  `).join('');

  document.querySelector('#about-flow').innerHTML = data.about.map((item, index) => `
    <article class="bubble ${index % 2 ? 'right' : ''}">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join('');
}

async function refresh() {
  render(await api('/api/bootstrap'));
  await renderArticleDetail(articleIdFromPath());
}

document.querySelector('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  await api('/api/messages', {
    method: 'POST',
    body: JSON.stringify({
      name: formData.get('name'),
      qq: formData.get('qq'),
      text: formData.get('text'),
    }),
  });
  form.reset();
  await refresh();
});

refresh().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="toast">${escapeHtml(error.message)}</div>`);
});

window.addEventListener('popstate', () => {
  renderArticleDetail(articleIdFromPath()).catch((error) => {
    document.body.insertAdjacentHTML('afterbegin', `<div class="toast">${escapeHtml(error.message)}</div>`);
  });
});
