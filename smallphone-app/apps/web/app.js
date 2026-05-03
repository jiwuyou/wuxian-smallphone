const state = {
  bootstrap: null,
  contacts: [],
  threads: [],
  worldbookEntries: [],
  permissionTemplates: {},
  threadPermissions: null,
  selectedThreadId: "",
  messages: [],
  reminders: [],
  activeScreen: "chat",
  companionDrawerMode: "create",
  editingContactId: "",
  archivedExpanded: false,
  threadDebug: null,
};

const els = {
  contactListActive: document.querySelector("#contact-list-active"),
  contactListArchived: document.querySelector("#contact-list-archived"),
  archivedToggleButton: document.querySelector("#archived-toggle-button"),
  archivedCountBadge: document.querySelector("#archived-count-badge"),
  threadTitle: document.querySelector("#thread-title"),
  threadSummary: document.querySelector("#thread-summary"),
  runtimeBadge: document.querySelector("#runtime-badge"),
  permissionSummary: document.querySelector("#permission-summary"),
  permissionSourceBadge: document.querySelector("#permission-source-badge"),
  permissionAgentMeta: document.querySelector("#permission-agent-meta"),
  permissionTemplateList: document.querySelector("#permission-template-list"),
  permissionDecisionList: document.querySelector("#permission-decision-list"),
  threadDebugPanel: document.querySelector("#thread-debug-panel"),
  threadDebugUpdated: document.querySelector("#thread-debug-updated"),
  threadDebugOverview: document.querySelector("#thread-debug-overview"),
  threadDebugContext: document.querySelector("#thread-debug-context"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  composerInput: document.querySelector("#composer-input"),
  reminderForm: document.querySelector("#reminder-form"),
  reminderNote: document.querySelector("#reminder-note"),
  reminderDue: document.querySelector("#reminder-due"),
  reminderList: document.querySelector("#reminder-list"),
  newCompanionButton: document.querySelector("#new-companion-button"),
  editCompanionButton: document.querySelector("#edit-companion-button"),
  archiveCompanionButton: document.querySelector("#archive-companion-button"),
  deleteCompanionButton: document.querySelector("#delete-companion-button"),
  companionDrawer: document.querySelector("#companion-drawer"),
  companionDrawerBackdrop: document.querySelector("#companion-drawer-backdrop"),
  closeCompanionDrawer: document.querySelector("#close-companion-drawer"),
  companionDrawerTitle: document.querySelector("#companion-drawer-title"),
  companionForm: document.querySelector("#companion-form"),
  companionName: document.querySelector("#companion-name"),
  companionDisplayName: document.querySelector("#companion-display-name"),
  companionAvatar: document.querySelector("#companion-avatar"),
  companionStyle: document.querySelector("#companion-style"),
  companionPersona: document.querySelector("#companion-persona"),
  companionWorldbookContent: document.querySelector("#companion-worldbook-content"),
  companionThreadSummary: document.querySelector("#companion-thread-summary"),
  companionGreeting: document.querySelector("#companion-greeting"),
  companionAgentType: document.querySelector("#companion-agent-type"),
  companionRoleLevel: document.querySelector("#companion-role-level"),
  companionAgentMode: document.querySelector("#companion-agent-mode"),
  companionTrust: document.querySelector("#companion-trust"),
  companionIntimacy: document.querySelector("#companion-intimacy"),
  companionTension: document.querySelector("#companion-tension"),
  companionResponsiveness: document.querySelector("#companion-responsiveness"),
  companionRelationshipState: document.querySelector("#companion-relationship-state"),
  companionRelationshipIntensity: document.querySelector("#companion-relationship-intensity"),
  companionToolAllow: document.querySelector("#companion-tool-allow"),
};

boot().catch((error) => {
  console.error(error);
  els.threadTitle.textContent = "加载失败";
  els.threadSummary.textContent = error.message;
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeScreen = button.dataset.screen;
    renderNav();
    renderScreens();
  });
});

els.newCompanionButton.addEventListener("click", () => openCompanionDrawer("create"));
els.archivedToggleButton.addEventListener("click", () => {
  state.archivedExpanded = !state.archivedExpanded;
  renderContacts();
});
els.editCompanionButton.addEventListener("click", () => {
  if (!getSelectedContact()) return;
  openCompanionDrawer("edit");
});
els.archiveCompanionButton.addEventListener("click", archiveSelectedCompanion);
els.deleteCompanionButton.addEventListener("click", deleteSelectedCompanion);
els.closeCompanionDrawer.addEventListener("click", closeCompanionDrawer);
els.companionDrawerBackdrop.addEventListener("click", closeCompanionDrawer);
els.companionAgentType?.addEventListener("change", () => {
  populateCompanionAgentModeOptions("", els.companionAgentType.value);
});

els.companionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = buildCompanionPayload();
  if (!payload.name) {
    return;
  }
  if (state.companionDrawerMode === "edit" && state.editingContactId) {
    await apiPatch(`/api/companions/${state.editingContactId}`, payload);
  } else {
    const created = await apiPost("/api/companions", payload);
    state.selectedThreadId = created.thread?.id || state.selectedThreadId;
  }
  closeCompanionDrawer();
  await refreshAll();
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.composerInput.value.trim();
  if (!text || !state.selectedThreadId) {
    return;
  }
  els.composerInput.value = "";
  await apiPost(`/api/threads/${state.selectedThreadId}/messages`, { text });
  await loadMessages();
  await loadThreads();
  await loadThreadDebug();
});

els.reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedThreadId) {
    return;
  }
  await apiPost("/api/reminders", {
    threadId: state.selectedThreadId,
    note: els.reminderNote.value.trim(),
    dueAt: new Date(els.reminderDue.value).toISOString(),
  });
  els.reminderNote.value = "";
  els.reminderDue.value = "";
  await loadReminders();
  await loadThreadDebug();
});

async function boot() {
  state.bootstrap = await apiGet("/api/bootstrap");
  state.contacts = state.bootstrap.contacts || [];
  state.threads = state.bootstrap.threads || [];
  state.worldbookEntries = await apiGet("/api/worldbook");
  state.permissionTemplates = await apiGet("/api/permissions/templates");
  state.selectedThreadId = resolvePreferredThreadId(state.threads, "");
  els.runtimeBadge.textContent = state.bootstrap.runtime.id;
  await Promise.all([loadMessages(), loadReminders(), loadThreadDebug(), loadThreadPermissions()]);
  render();
}

async function refreshAll() {
  state.contacts = await apiGet("/api/contacts");
  state.worldbookEntries = await apiGet("/api/worldbook");
  await loadThreads();
  await Promise.all([loadMessages(), loadReminders(), loadThreadDebug(), loadThreadPermissions()]);
  render();
}

async function loadThreads() {
  state.threads = await apiGet("/api/threads");
  state.selectedThreadId = resolvePreferredThreadId(state.threads, state.selectedThreadId);
  await Promise.all([loadThreadDebug(), loadThreadPermissions()]);
  renderContacts();
  renderHeader();
}

async function loadMessages() {
  if (!state.selectedThreadId) {
    state.messages = [];
    renderMessages();
    return;
  }
  state.messages = await apiGet(`/api/threads/${state.selectedThreadId}/messages`);
  renderMessages();
  renderHeader();
}

async function loadReminders() {
  state.reminders = await apiGet("/api/reminders");
  renderReminders();
}

async function loadThreadDebug() {
  if (!state.selectedThreadId) {
    state.threadDebug = null;
    renderThreadDebug();
    return;
  }
  state.threadDebug = await apiGet(`/api/threads/${state.selectedThreadId}/debug`);
  renderThreadDebug();
}

async function loadThreadPermissions() {
  if (!state.selectedThreadId) {
    state.threadPermissions = null;
    renderPermissions();
    return;
  }
  state.threadPermissions = await apiGet(`/api/threads/${state.selectedThreadId}/permissions`);
  renderPermissions();
}

function render() {
  renderNav();
  renderScreens();
  renderContacts();
  renderHeader();
  renderThreadDebug();
  renderPermissions();
  renderMessages();
  renderReminders();
}

function renderNav() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === state.activeScreen);
  });
}

function renderScreens() {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.id === `screen-${state.activeScreen}`);
  });
}

function renderContacts() {
  const activeContacts = state.contacts.filter((contact) => contact.status !== "archived");
  const archivedContacts = state.contacts.filter((contact) => contact.status === "archived");
  els.archivedCountBadge.textContent = String(archivedContacts.length);
  els.contactListArchived.classList.toggle("hidden", !state.archivedExpanded);

  els.contactListActive.innerHTML = activeContacts.length
    ? activeContacts.map((contact) => renderContactCard(contact)).join("")
    : `<article class="card"><div>还没有活跃联系人。</div></article>`;

  els.contactListArchived.innerHTML = archivedContacts.length
    ? archivedContacts.map((contact) => renderContactCard(contact)).join("")
    : `<article class="card"><div>没有归档联系人。</div></article>`;

  [els.contactListActive, els.contactListArchived].forEach((container) => {
    container.querySelectorAll("[data-thread-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        state.selectedThreadId = node.dataset.threadId || "";
        await Promise.all([loadMessages(), loadThreadDebug(), loadThreadPermissions()]);
        renderContacts();
        renderReminders();
      });
    });
  });
}

function renderContactCard(contact) {
  const thread = state.threads.find((item) => item.contactId === contact.id) || contact.thread;
  const active = thread?.id === state.selectedThreadId;
  const trust = contact.relationship?.trust ?? 0;
  return `
        <button class="contact-card ${active ? "active" : ""} ${contact.status === "archived" ? "archived" : ""}" data-thread-id="${thread?.id || ""}">
          <div class="contact-name">${escapeHtml(contact.displayName)}</div>
          <div class="contact-meta">${escapeHtml(contact.status || "active")} · trust ${trust.toFixed(2)} · ${escapeHtml(contact.character?.style || "")}</div>
        </button>
      `;
}

function renderHeader() {
  const thread = getSelectedThread();
  const contact = getSelectedContact();
  els.threadTitle.textContent = thread?.title || "No thread";
  els.threadSummary.textContent = thread?.summary || "No summary yet.";
  const disabled = !contact;
  els.editCompanionButton.disabled = disabled;
  els.archiveCompanionButton.disabled = disabled || contact?.status === "archived";
  els.deleteCompanionButton.disabled = disabled;
}

function renderMessages() {
  els.messages.innerHTML = state.messages
    .map(
      (message) => `
        <article class="message ${message.role}">
          <div>${escapeHtml(message.content)}</div>
          <div class="message-meta">${escapeHtml(message.role)} · ${formatTime(message.createdAt)}</div>
        </article>
      `,
    )
    .join("");
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderThreadDebug() {
  const debug = state.threadDebug;
  if (!debug || !state.selectedThreadId) {
    els.threadDebugPanel.classList.add("hidden");
    els.threadDebugUpdated.textContent = "";
    els.threadDebugOverview.innerHTML = "";
    els.threadDebugContext.innerHTML = "";
    return;
  }
  const record = debug.turnContextRecord || {};
  const meta = record.runtimeMeta || {};
  const turnContext = record.turnContext || {};
  const relationship = record.relationship || {};
  const toolSummary = meta.toolSummary || {};
  const worldbookEntries = Array.isArray(turnContext.matchedWorldbookEntries)
    ? turnContext.matchedWorldbookEntries
    : [];
  const guidance = Array.isArray(turnContext.replyGuidance) ? turnContext.replyGuidance : [];
  const tools = Array.isArray(toolSummary.tools) ? toolSummary.tools : [];
  els.threadDebugPanel.classList.remove("hidden");
  els.threadDebugUpdated.textContent = `更新于 ${formatTime(record.updatedAt || turnContext.generatedAt)}`;
  els.threadDebugOverview.innerHTML = [
    renderDebugMetric("session", debug.sessionKey || "-"),
    renderDebugMetric("state", turnContext.relationshipState?.id || "-"),
    renderDebugMetric("mask", turnContext.activeMask?.id || "none"),
    renderDebugMetric("trust", formatDecimal(relationship.trust)),
    renderDebugMetric("prompt", meta.finalPromptText ? "captured" : "missing"),
    renderDebugMetric("tools", tools.length ? tools.join(", ") : "none"),
    renderDebugMetric("stop", meta.stopReason || "-"),
    renderDebugMetric("failures", stringifyCount(toolSummary.failures)),
  ].join("");
  els.threadDebugContext.innerHTML = `
    <article class="card debug-card">
      <div class="panel-title">命中世界书</div>
      <div class="debug-token-list">${worldbookEntries.length ? worldbookEntries.map((entry) => `<span class="debug-token">${escapeHtml(entry.name || entry.id || "entry")}</span>`).join("") : `<span class="card-meta">暂无</span>`}</div>
    </article>
    <article class="card debug-card">
      <div class="panel-title">回复指导</div>
      <div class="debug-list">${guidance.length ? guidance.map((item) => `<div class="debug-list-item">${escapeHtml(item)}</div>`).join("") : `<span class="card-meta">暂无</span>`}</div>
    </article>
  `;
}

function renderPermissions() {
  if (!els.permissionTemplateList || !els.permissionDecisionList) {
    return;
  }
  const permissions = state.threadPermissions;
  if (!permissions || !state.selectedThreadId) {
    els.permissionSummary.textContent = "请选择一个联系人。";
    els.permissionSourceBadge.textContent = "local";
    if (els.permissionAgentMeta) els.permissionAgentMeta.innerHTML = "";
    els.permissionTemplateList.innerHTML = "";
    els.permissionDecisionList.innerHTML = "";
    return;
  }
  const capabilities = permissions.agentCapabilities || {};
  const modes = Array.isArray(capabilities.modes) ? capabilities.modes : [];
  els.permissionSummary.textContent = `${permissions.contactName || "当前联系人"} · agent=${permissions.agentType || "codex"} · project=${permissions.runtimeProject || permissions.project || "-"}`;
  els.permissionSourceBadge.textContent = capabilities.source === "cc-connect-project"
    ? "cc-connect project"
    : permissions.evaluation?.remote_error
      ? "local fallback"
      : permissions.configured
        ? "cc-connect"
        : "local";
  const currentAgentMode = permissions.agentMode || capabilities.defaultMode || "default";
  if (els.permissionAgentMeta) {
    els.permissionAgentMeta.innerHTML = [
      renderPermissionMeta("agentId", permissions.agentId || "-"),
      renderPermissionMeta("role", permissions.roleLevel || "contact"),
      renderPermissionMeta("workspace", permissions.workspaceDir || "-"),
    ].join("");
  }
  els.permissionTemplateList.innerHTML = modes.length
    ? modes
        .map((mode) => {
          const key = String(mode.key || "");
          const active = key === currentAgentMode;
          const title = mode.nameZh || mode.name || key;
          const description = mode.descriptionZh || mode.description || "";
          return `
        <button class="permission-template ${active ? "active" : ""}" data-template="${escapeHtml(key)}" type="button">
          <span class="permission-template-name">${escapeHtml(title)}</span>
          <span class="permission-template-desc">${escapeHtml(description)}</span>
        </button>
      `;
        })
        .join("")
    : `<article class="card"><div>当前 agent 没有暴露可选权限模式。</div></article>`;
  els.permissionTemplateList.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveThreadPermissionPatch({ agentMode: button.dataset.template });
    });
  });

  const decisions = permissions.evaluation?.decisions || {};
  const orderedPermissions = capabilities.permissions || Object.keys(decisions);
  els.permissionDecisionList.innerHTML = orderedPermissions.length
    ? orderedPermissions
        .map((permission) => {
          const key = String(permission || "").trim();
          const decision = decisions[key] || { permission: key, level: permissions.rules?.[key] || "ask", source: "implicit" };
          const level = String(decision.level || "ask");
          return `
            <article class="permission-row ${escapeHtml(level)}">
              <div>
                <div class="permission-name">${escapeHtml(key)}</div>
                <div class="card-meta">source: ${escapeHtml(decision.source || "-")}</div>
              </div>
              <select class="permission-level-select" data-permission="${escapeHtml(key)}">
                ${["allow", "ask", "forbid"].map((item) => `<option value="${item}" ${item === level ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </article>
          `;
        })
        .join("")
    : `<article class="card"><div>暂无权限评估。</div></article>`;
  els.permissionDecisionList.querySelectorAll("[data-permission]").forEach((select) => {
    select.addEventListener("change", async () => {
      await saveThreadPermissionPatch({
        rules: {
          ...(state.threadPermissions?.rules || {}),
          [select.dataset.permission]: select.value,
        },
      });
    });
  });
}

function renderPermissionMeta(label, value) {
  return `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`;
}

async function saveThreadPermissionPatch(patch) {
  await apiPost(`/api/threads/${state.selectedThreadId}/permissions`, {
    agentMode: patch.agentMode || state.threadPermissions?.agentMode,
    rules: patch.rules || state.threadPermissions?.rules || {},
  });
  await Promise.all([loadThreadPermissions(), loadThreads()]);
}

function renderReminders() {
  const reminders = state.selectedThreadId
    ? state.reminders.filter((item) => item.threadId === state.selectedThreadId)
    : [];
  els.reminderList.innerHTML = reminders.length
    ? reminders
        .map(
          (item) => `
            <article class="card">
              <div>${escapeHtml(item.note)}</div>
              <div class="card-meta">${formatTime(item.dueAt)} · ${escapeHtml(item.status)}</div>
            </article>
          `,
        )
        .join("")
    : `<article class="card"><div>当前联系人还没有提醒。</div></article>`;
}

async function openCompanionDrawer(mode) {
  state.companionDrawerMode = mode;
  const contact = getSelectedContact();
  const thread = getSelectedThread();
  const relationshipState = getSelectedRelationshipState();
  els.companionDrawer.classList.remove("hidden");
  els.companionDrawer.setAttribute("aria-hidden", "false");
  els.companionDrawerTitle.textContent = mode === "edit" ? "编辑角色" : "新建角色";
  if (mode === "edit" && contact && thread) {
    let permissions = state.threadPermissions;
    if (!permissions || permissions.threadId !== thread.id) {
      try {
        permissions = await apiGet(`/api/threads/${thread.id}/permissions`);
      } catch {
        permissions = null;
      }
    }
    state.editingContactId = contact.id;
    els.companionName.value = contact.character?.name || contact.displayName || "";
    els.companionDisplayName.value = contact.displayName || "";
    els.companionAvatar.value = contact.character?.avatar || "";
    els.companionStyle.value = contact.character?.style || "";
    els.companionPersona.value = contact.character?.persona || "";
    els.companionWorldbookContent.value = resolveWorldbookContent(contact, thread);
    els.companionThreadSummary.value = thread.summary || "";
    els.companionGreeting.value = "";
    els.companionTrust.value = stringifyNumber(contact.relationship?.trust);
    els.companionIntimacy.value = stringifyNumber(contact.relationship?.intimacy);
    els.companionTension.value = stringifyNumber(contact.relationship?.tension);
    els.companionResponsiveness.value = stringifyNumber(contact.relationship?.responsiveness);
    els.companionRelationshipState.value = relationshipState?.state || "";
    els.companionRelationshipIntensity.value = stringifyNumber(relationshipState?.intensity);
    els.companionToolAllow.value = Array.isArray(contact.character?.toolPolicy?.allow)
      ? contact.character.toolPolicy.allow.join(",")
      : "";
    if (els.companionAgentType) els.companionAgentType.value = permissions?.agentType || thread.runtime?.agentType || "codex";
    if (els.companionRoleLevel) els.companionRoleLevel.value = contact.roleLevel || thread.roleLevel || "contact";
    populateCompanionAgentModeOptions(
      permissions?.agentMode || "",
      els.companionAgentType?.value || "codex",
      permissions?.agentCapabilities?.modes,
    );
  } else {
    state.editingContactId = "";
    els.companionForm.reset();
    if (els.companionAgentType) els.companionAgentType.value = "codex";
    if (els.companionRoleLevel) els.companionRoleLevel.value = "contact";
    populateCompanionAgentModeOptions("suggest", "codex");
  }
}

function closeCompanionDrawer() {
  els.companionDrawer.classList.add("hidden");
  els.companionDrawer.setAttribute("aria-hidden", "true");
  state.editingContactId = "";
}

async function archiveSelectedCompanion() {
  const contact = getSelectedContact();
  if (!contact || !window.confirm(`归档 ${contact.displayName}？`)) {
    return;
  }
  await apiPost(`/api/companions/${contact.id}/archive`, {});
  state.archivedExpanded = true;
  await refreshAll();
}

async function deleteSelectedCompanion() {
  const contact = getSelectedContact();
  if (!contact || !window.confirm(`彻底删除 ${contact.displayName}？`)) {
    return;
  }
  await apiDelete(`/api/companions/${contact.id}`);
  state.selectedThreadId = "";
  await refreshAll();
}

function buildCompanionPayload() {
  const trust = maybeNumber(els.companionTrust.value);
  const intimacy = maybeNumber(els.companionIntimacy.value);
  const tension = maybeNumber(els.companionTension.value);
  const responsiveness = maybeNumber(els.companionResponsiveness.value);
  const relationshipIntensity = maybeNumber(els.companionRelationshipIntensity.value);
  const toolAllow = els.companionToolAllow.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return compactObject({
    name: els.companionName.value.trim(),
    displayName: els.companionDisplayName.value.trim(),
    avatar: els.companionAvatar.value.trim(),
    style: els.companionStyle.value.trim(),
    persona: els.companionPersona.value.trim(),
    worldbookContent: els.companionWorldbookContent.value.trim(),
    threadSummary: els.companionThreadSummary.value.trim(),
    greeting: els.companionGreeting.value.trim(),
    agentType: els.companionAgentType?.value || "codex",
    roleLevel: els.companionRoleLevel?.value || "contact",
    agentMode: els.companionAgentMode?.value || "",
    toolPolicy: toolAllow.length ? { allow: toolAllow } : undefined,
    relationship:
      trust != null || intimacy != null || tension != null || responsiveness != null
        ? compactObject({ trust, intimacy, tension, responsiveness })
        : undefined,
    relationshipState:
      els.companionRelationshipState.value.trim() || relationshipIntensity != null
        ? compactObject({
            state: els.companionRelationshipState.value.trim(),
            intensity: relationshipIntensity,
          })
        : undefined,
  });
}

function populateCompanionAgentModeOptions(selectedMode, agentType, runtimeModes) {
  if (!els.companionAgentMode) return;
  const modes = normalizeAgentModeOptions(runtimeModes) || getAgentModeOptions(agentType);
  const selected = selectedMode || modes[0]?.key || "";
  els.companionAgentMode.innerHTML = modes
    .map((mode) => `<option value="${escapeHtml(mode.key)}" ${mode.key === selected ? "selected" : ""}>${escapeHtml(mode.label)}</option>`)
    .join("");
}

function normalizeAgentModeOptions(runtimeModes) {
  if (!Array.isArray(runtimeModes) || !runtimeModes.length) return null;
  return runtimeModes
    .map((mode) => {
      const key = String(mode?.key || "").trim();
      if (!key) return null;
      const name = mode.nameZh || mode.name || key;
      const description = mode.descriptionZh || mode.description || "";
      return {
        key,
        label: description ? `${name} · ${description}` : name,
      };
    })
    .filter(Boolean);
}

function getAgentModeOptions(agentType) {
  if (agentType === "claudecode") {
    return [
      { key: "default", label: "默认 · 每次工具调用确认" },
      { key: "acceptEdits", label: "接受编辑 · 自动允许文件编辑" },
      { key: "plan", label: "计划模式 · 只规划不执行" },
      { key: "auto", label: "自动模式 · Claude 判断何时确认" },
      { key: "bypassPermissions", label: "YOLO · 全部自动通过" },
      { key: "dontAsk", label: "静默拒绝 · 未授权工具自动拒绝" },
    ];
  }
  return [
    { key: "suggest", label: "建议 · 每次工具调用确认" },
    { key: "auto-edit", label: "自动编辑 · 文件编辑自动通过" },
    { key: "full-auto", label: "全自动 · 工作区沙箱内自动通过" },
    { key: "yolo", label: "YOLO · 跳过审批和沙箱" },
  ];
}

function getSelectedThread() {
  return state.threads.find((item) => item.id === state.selectedThreadId) || null;
}

function getSelectedContact() {
  const thread = getSelectedThread();
  if (!thread) return null;
  return state.contacts.find((item) => item.id === thread.contactId) || null;
}

function getSelectedRelationshipState() {
  const thread = getSelectedThread();
  if (!thread) return null;
  return thread.relationshipState || null;
}

function resolveWorldbookContent(contact, thread) {
  const bootstrapContact = (state.bootstrap?.contacts || []).find((item) => item.id === contact.id);
  const entry = (state.worldbookEntries || []).find(
    (item) =>
      bootstrapContact?.worldbookScopeIds?.includes(item.id) ||
      item.triggers?.contactIds?.includes(contact.id) ||
      item.triggers?.threadIds?.includes(thread.id),
  );
  return entry?.content || "";
}

function resolvePreferredThreadId(threads, previous) {
  const previousThread = threads.find((item) => item.id === previous);
  if (previousThread) {
    return previousThread.id;
  }
  return threads.find((item) => item.state === "active")?.id || threads[0]?.id || "";
}

async function apiGet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed`);
  }
  return response.json();
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} failed`);
  }
  return response.json();
}

async function apiPatch(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${url} failed`);
  }
  return response.json();
}

async function apiDelete(url) {
  const response = await fetch(url, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`DELETE ${url} failed`);
  }
  return response.json();
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderDebugMetric(label, value) {
  return `
    <article class="card debug-metric">
      <div class="panel-title">${escapeHtml(label)}</div>
      <div class="debug-metric-value">${escapeHtml(value)}</div>
    </article>
  `;
}

function formatDecimal(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "-";
}

function stringifyCount(value) {
  return Number.isFinite(Number(value)) ? String(value) : "0";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function maybeNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringifyNumber(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim() !== "";
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }),
  );
}
