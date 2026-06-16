const state = {
  bootstrap: null,
  contacts: [],
  threads: [],
  worldbookEntries: [],
  permissionTemplates: {},
  threadPermissions: null,
  workflows: [],
  workflowsMeta: {
    phase: "idle", // idle | loading | loaded | error
    source: "",
    loadedAt: "",
    error: "",
  },
  selectedThreadId: "",
  messages: [],
  reminders: [],
  activeScreen: "chat",
  companionDrawerMode: "create",
  editingContactId: "",
  archivedExpanded: false,
  threadDebug: null,
  companionRuntimeSettings: {
    threadId: "",
    phase: "idle",
    available: false,
    project: "",
    reason: "",
    error: "",
    settings: null,
  },
};

const DEFAULT_TIMEZONE = "Etc/UTC";
const DEFAULT_WAIFU_DELAY_MS_PER_CHAR = 55;
const MIN_WAIFU_SEGMENT_DELAY_MS = 280;
const MAX_WAIFU_SEGMENT_DELAY_MS = 1400;
const WAIFU_SETTINGS_STORAGE_KEY = "smallphone.web.waifuTextSettings";
const WAIFU_DISPLAYED_STORAGE_KEY = "smallphone.web.waifuDisplayedMessages";

let companionRuntimeRequestId = 0;
let companionRuntimeSaving = false;
let waifuDisplayTimers = [];
const waifuSettingsByContactId = loadWaifuSettingsFromStorage();
const displayedWaifuMessageKeys = loadDisplayedWaifuKeysFromStorage();

const els = {
  contactListActive: document.querySelector("#contact-list-active"),
  contactListArchived: document.querySelector("#contact-list-archived"),
  archivedToggleButton: document.querySelector("#archived-toggle-button"),
  archivedCountBadge: document.querySelector("#archived-count-badge"),
  threadTitle: document.querySelector("#thread-title"),
  threadSummary: document.querySelector("#thread-summary"),
  runtimeBadge: document.querySelector("#runtime-badge"),
  workflowSummary: document.querySelector("#workflow-summary"),
  workflowList: document.querySelector("#workflow-list"),
  reloadWorkflowsButton: document.querySelector("#reload-workflows-button"),
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
  companionRuntimeStatus: document.querySelector("#companion-runtime-status"),
  companionRuntimeReplyFooter: document.querySelector("#companion-runtime-reply-footer"),
  companionRuntimeContextIndicator: document.querySelector("#companion-runtime-context-indicator"),
  companionRuntimeWorkDir: document.querySelector("#companion-runtime-work-dir"),
  companionRuntimeDisabledCommands: document.querySelector("#companion-runtime-disabled-commands"),
  companionRuntimeAdminFrom: document.querySelector("#companion-runtime-admin-from"),
  companionWaifuTextMode: document.querySelector("#companion-waifu-text-mode"),
  companionWaifuRemovePunctuation: document.querySelector("#companion-waifu-remove-punctuation"),
  companionWaifuDelay: document.querySelector("#companion-waifu-delay"),
  companionWaifuDelayValue: document.querySelector("#companion-waifu-delay-value"),
  companionTimeInjectionEnabled: document.querySelector("#companion-time-injection-enabled"),
  companionTimezone: document.querySelector("#companion-timezone"),
  companionTrust: document.querySelector("#companion-trust"),
  companionIntimacy: document.querySelector("#companion-intimacy"),
  companionTension: document.querySelector("#companion-tension"),
  companionResponsiveness: document.querySelector("#companion-responsiveness"),
  companionRelationshipState: document.querySelector("#companion-relationship-state"),
  companionRelationshipIntensity: document.querySelector("#companion-relationship-intensity"),
  companionToolAllow: document.querySelector("#companion-tool-allow"),
  companionWorkflowStatus: document.querySelector("#companion-workflow-status"),
  companionWorkflowSelect: document.querySelector("#companion-workflow-select"),
  companionWorkflowMeta: document.querySelector("#companion-workflow-meta"),
  companionWorkflowFields: document.querySelector("#companion-workflow-fields"),
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

els.reloadWorkflowsButton?.addEventListener("click", async () => {
  await loadWorkflows({ force: true });
  renderWorkflows();
  renderCompanionWorkflowSection();
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
  renderCompanionRuntimeSettings();
});
els.companionWaifuDelay?.addEventListener("input", () => {
  const value = Number(els.companionWaifuDelay.value || DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  if (els.companionWaifuDelayValue) {
    els.companionWaifuDelayValue.textContent = `${value} ms/字`;
  }
});

els.companionWorkflowSelect?.addEventListener("change", () => {
  renderCompanionWorkflowSection({ preserveValues: true });
});

els.companionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = buildCompanionPayload();
  if (!payload.name) {
    return;
  }
  const waifuSettings = normalizeWaifuSettings({
    enabled: els.companionWaifuTextMode?.checked,
    removePunctuation: els.companionWaifuRemovePunctuation?.checked,
    typingDelayMsPerChar: els.companionWaifuDelay?.value,
  });
  const runtimeThreadId = state.companionDrawerMode === "edit" ? String(state.selectedThreadId || "") : "";
  const runtimePayload = buildCompanionRuntimeSettingsPayload();
  if (state.companionDrawerMode === "edit" && state.editingContactId) {
    setWaifuSettingsForContact(state.editingContactId, waifuSettings);
    await apiPatch(`/api/companions/${state.editingContactId}`, payload);
    await saveCompanionRuntimeSettingsIfAvailable(runtimeThreadId, runtimePayload);
  } else {
    const created = await apiPost("/api/companions", payload);
    setWaifuSettingsForContact(created.contact?.id, waifuSettings);
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
  await apiPost(`/api/threads/${state.selectedThreadId}/messages`, { text, textParts: [text] });
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
  await loadWorkflows();
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
  const previousMessages = Array.isArray(state.messages) ? state.messages : [];
  const nextMessages = await apiGet(`/api/threads/${state.selectedThreadId}/messages`);
  state.messages = hydrateWaifuMessages(nextMessages, previousMessages);
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
  renderWorkflows();
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

async function loadWorkflows({ force = false } = {}) {
  if (!force && ["loading", "loaded"].includes(state.workflowsMeta.phase)) {
    return state.workflows;
  }
  state.workflowsMeta = { phase: "loading", source: "", loadedAt: "", error: "" };
  renderWorkflows();
  renderCompanionWorkflowSection();

  const endpoints = ["/api/contact-workflows", "/api/workflows"];
  let lastError = "";
  for (const endpoint of endpoints) {
    try {
      const result = await apiGet(endpoint);
      const list = normalizeWorkflowListResult(result);
      state.workflows = list;
      state.workflowsMeta = {
        phase: "loaded",
        source: endpoint,
        loadedAt: new Date().toISOString(),
        error: "",
      };
      return state.workflows;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  state.workflows = [];
  state.workflowsMeta = {
    phase: "error",
    source: "",
    loadedAt: new Date().toISOString(),
    error: lastError || "load workflows failed",
  };
  return state.workflows;
}

function normalizeWorkflowListResult(result) {
  const source = result && typeof result === "object" ? result : null;
  const candidate = Array.isArray(result)
    ? result
    : Array.isArray(source?.workflows)
      ? source.workflows
      : Array.isArray(source?.items)
        ? source.items
        : Array.isArray(source?.data)
          ? source.data
          : [];
  return (Array.isArray(candidate) ? candidate : [])
    .map((item) => normalizeWorkflow(item))
    .filter((item) => item && item.id);
}

function normalizeWorkflow(workflow) {
  const raw = workflow && typeof workflow === "object" ? workflow : {};
  const id = String(raw.workflowId || raw.id || raw.key || raw.name || "").trim();
  if (!id) return null;
  const versionRaw = raw.workflowVersion ?? raw.version ?? raw.rev ?? raw.revision ?? raw.schemaVersion;
  const version = String(versionRaw == null ? "" : versionRaw).trim();
  const label = String(raw.displayName || raw.title || raw.name || raw.label || id).trim();
  const description = String(raw.descriptionZh || raw.description || raw.summary || "").trim();
  const contactConfigSchema = raw.contactConfigSchema || raw.contactSchema || raw.schema || raw.contactSchemaJson || null;
  const inputSources = raw.inputSources || raw.inputSource || raw.sources || raw.source || null;
  const rules = raw.rules || raw.inputRules || raw.validationRules || raw.policy || null;
  return {
    id,
    version,
    label,
    description,
    contactConfigSchema,
    inputSources,
    rules,
    raw,
  };
}

function renderWorkflows() {
  if (!els.workflowList || !els.workflowSummary) return;

  const meta = state.workflowsMeta || {};
  const count = Array.isArray(state.workflows) ? state.workflows.length : 0;
  const statusText =
    meta.phase === "loading"
      ? "加载中…"
      : meta.phase === "error"
        ? `加载失败：${meta.error || "unknown"}`
        : meta.phase === "loaded"
          ? `已加载 ${count} 个 · source=${meta.source}`
          : "未加载";
  els.workflowSummary.textContent = statusText;

  if (!count) {
    els.workflowList.innerHTML =
      meta.phase === "error"
        ? `<article class="card"><div>无法加载 workflows。</div><div class="card-meta">${escapeHtml(meta.error || "")}</div></article>`
        : `<article class="card"><div>暂无 workflows。</div></article>`;
    return;
  }

  els.workflowList.innerHTML = state.workflows
    .map((workflow) => {
      const schema = normalizeJsonSchema(workflow.contactConfigSchema);
      const fields = schema?.properties && typeof schema.properties === "object" ? Object.entries(schema.properties) : [];
      const required = new Set(Array.isArray(schema?.required) ? schema.required.map((k) => String(k)) : []);
      const fieldRows = fields.length
        ? fields
            .map(([key, fieldSchema]) => {
              const fs = normalizeJsonSchema(fieldSchema);
              const type = inferSchemaTypeLabel(fs);
              const src = resolveSchemaMeta(fs, ["source", "inputSource", "from", "origin", "x-source"]);
              const rule = resolveSchemaMeta(fs, ["rule", "rules", "x-rule", "x-rules", "pattern"]);
              const desc = String(fs?.description || fs?.descriptionZh || "").trim();
              const metaBits = [
                required.has(String(key)) ? "required" : "",
                src ? `source:${src}` : "",
                rule ? `rule:${rule}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return `
                <article class="card">
                  <div class="workflow-card-head">
                    <div>
                      <div class="workflow-name">${escapeHtml(String(fs?.title || fs?.name || key))}</div>
                      <div class="workflow-id">${escapeHtml(String(key))} · ${escapeHtml(type)}</div>
                    </div>
                  </div>
                  ${metaBits ? `<div class="card-meta">${escapeHtml(metaBits)}</div>` : ""}
                  ${desc ? `<div class="card-meta">${escapeHtml(desc)}</div>` : ""}
                </article>
              `;
            })
            .join("")
        : `<article class="card"><div>该 workflow 未提供 contactConfigSchema.properties。</div></article>`;

      const extras = compactObject({
        inputSources: workflow.inputSources,
        rules: workflow.rules,
      });

      return `
        <article class="card">
          <div class="workflow-card-head">
            <div>
              <div class="workflow-name">${escapeHtml(workflow.label || workflow.id)}</div>
              <div class="workflow-id">${escapeHtml(workflow.id)}${workflow.version ? ` · v${escapeHtml(workflow.version)}` : ""}</div>
              ${workflow.description ? `<div class="card-meta">${escapeHtml(workflow.description)}</div>` : ""}
            </div>
          </div>
          <div class="workflow-kv">
            <strong>Fields</strong>
            <div class="card-meta">${escapeHtml(String(fields.length))}</div>
            <strong>Required</strong>
            <div class="card-meta">${escapeHtml(Array.from(required).join(", ") || "-")}</div>
          </div>
          ${Object.keys(extras).length ? `<pre class="workflow-pre">${escapeHtml(JSON.stringify(extras, null, 2))}</pre>` : ""}
        </article>
        ${fieldRows}
      `;
    })
    .join("");
}

function normalizeJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return null;
  // Allow wrapper like { schema: {...} } or { jsonSchema: {...} }
  if (schema.schema && typeof schema.schema === "object") return schema.schema;
  if (schema.jsonSchema && typeof schema.jsonSchema === "object") return schema.jsonSchema;
  return schema;
}

function inferSchemaTypeLabel(schema) {
  const s = schema && typeof schema === "object" ? schema : {};
  if (Array.isArray(s.enum)) return "enum";
  const type = String(s.type || "").trim();
  if (type) return type;
  if (s.properties) return "object";
  return "unknown";
}

function resolveSchemaMeta(schema, keys) {
  const s = schema && typeof schema === "object" ? schema : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(s, key) && s[key] != null) {
      return String(s[key]).trim();
    }
  }
  return "";
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
  clearWaifuDisplayTimers();
  els.messages.innerHTML = state.messages
    .map(
      (message) => `
        <article class="message ${message.role}">
          ${renderMessageContent(message)}
          <div class="message-meta">${escapeHtml(message.role)} · ${formatTime(message.createdAt)}</div>
        </article>
      `,
    )
    .join("");
  requestAnimationFrame(() => {
    scheduleWaifuSegments();
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function hydrateWaifuMessages(nextMessages, previousMessages) {
  const previousById = new Map();
  const previousBySignature = new Map();
  (Array.isArray(previousMessages) ? previousMessages : []).forEach((message) => {
    const id = String(message?.id || "").trim();
    const signature = buildMessageSignature(message);
    if (id) previousById.set(id, message);
    if (signature) previousBySignature.set(signature, message);
  });

  return (Array.isArray(nextMessages) ? nextMessages : []).map((message) => {
    const copy = { ...message };
    const id = String(copy.id || "").trim();
    const signature = buildMessageSignature(copy);
    const messageKey = buildWaifuMessageKey(copy);
    const previous = id ? previousById.get(id) : previousBySignature.get(signature);
    copy.waifuMessageKey = messageKey;
    if (previous && Object.prototype.hasOwnProperty.call(previous, "waifuDisplayPending")) {
      copy.waifuDisplayPending = Boolean(previous.waifuDisplayPending);
      return copy;
    }
    if (
      copy.role === "assistant"
      && !copy.streaming
      && getSelectedWaifuSettings().enabled
      && messageKey
      && !displayedWaifuMessageKeys.has(messageKey)
    ) {
      copy.waifuDisplayPending = true;
    }
    return copy;
  });
}

function buildMessageSignature(message) {
  const role = String(message?.role || "").trim();
  const createdAt = String(message?.createdAt || "").trim();
  const content = String(message?.content || "").trim();
  if (!role && !createdAt && !content) return "";
  return [role, createdAt, content].join("|");
}

function buildWaifuMessageKey(message) {
  const id = String(message?.id || "").trim();
  if (id) return `${state.selectedThreadId || "thread"}:${id}`;
  return `${state.selectedThreadId || "thread"}:${buildMessageSignature(message)}`;
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

function normalizeRuntimeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return false;
}

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeTimezone(value) {
  const raw = String(value || "").trim() || getBrowserTimezone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeTimeSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    enabled: normalizeRuntimeBoolean(source.enabled ?? source.injectCurrentTime ?? source.timeInjectionEnabled),
    timezone: normalizeTimezone(source.timezone || source.timeZone || source.tz),
  };
}

function normalizeWaifuSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const delay = Number(source.typingDelayMsPerChar ?? source.delayMsPerChar ?? source.typingDelay ?? DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  return {
    enabled: normalizeRuntimeBoolean(source.enabled ?? source.textMode ?? source.waifuTextMode),
    removePunctuation: normalizeRuntimeBoolean(source.removePunctuation ?? source.stripPunctuation),
    typingDelayMsPerChar: Number.isFinite(delay)
      ? Math.min(160, Math.max(20, Math.round(delay)))
      : DEFAULT_WAIFU_DELAY_MS_PER_CHAR,
  };
}

function getSelectedTimeSettings() {
  const thread = getSelectedThread();
  const contact = getSelectedContact();
  return normalizeTimeSettings(thread?.timeSettings || contact?.timeSettings || {});
}

function getWaifuSettingsForContact(contactId) {
  const key = String(contactId || "").trim();
  return normalizeWaifuSettings(key ? waifuSettingsByContactId.get(key) : {});
}

function loadWaifuSettingsFromStorage() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WAIFU_SETTINGS_STORAGE_KEY) || "{}");
    return new Map(Object.entries(parsed).map(([contactId, settings]) => [contactId, normalizeWaifuSettings(settings)]));
  } catch {
    return new Map();
  }
}

function saveWaifuSettingsToStorage() {
  try {
    window.localStorage.setItem(
      WAIFU_SETTINGS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(waifuSettingsByContactId.entries())),
    );
  } catch {}
}

function loadDisplayedWaifuKeysFromStorage() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WAIFU_DISPLAYED_STORAGE_KEY) || "[]");
    return new Set((Array.isArray(parsed) ? parsed : []).map((item) => String(item || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveDisplayedWaifuKeysToStorage() {
  try {
    const keys = Array.from(displayedWaifuMessageKeys).slice(-500);
    displayedWaifuMessageKeys.clear();
    keys.forEach((key) => displayedWaifuMessageKeys.add(key));
    window.localStorage.setItem(WAIFU_DISPLAYED_STORAGE_KEY, JSON.stringify(keys));
  } catch {}
}

function markWaifuMessageDisplayed(message) {
  const key = String(message?.waifuMessageKey || buildWaifuMessageKey(message)).trim();
  if (!key) return;
  displayedWaifuMessageKeys.add(key);
  saveDisplayedWaifuKeysToStorage();
}

function setWaifuSettingsForContact(contactId, settings) {
  const key = String(contactId || "").trim();
  if (!key) return;
  waifuSettingsByContactId.set(key, normalizeWaifuSettings(settings));
  saveWaifuSettingsToStorage();
}

function getSelectedWaifuSettings() {
  return getWaifuSettingsForContact(getSelectedContact()?.id);
}

function splitWaifuSegments(text) {
  const source = String(text || "").trim();
  if (!source) return [];
  const matches = source.match(/[^。！？!?；;\n]+[。！？!?；;]*|[\n]+/g) || [source];
  const segments = matches.map((segment) => segment.trim()).filter(Boolean);
  return segments.length ? segments : [source];
}

function stripDisplayPunctuation(text) {
  return String(text || "").replace(/[。！？!?；;，,、.]+$/g, "").trim();
}

function getWaifuSegmentDelay(segment, settings) {
  const delayPerChar = Number(settings?.typingDelayMsPerChar || DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  const computed = String(segment || "").length * delayPerChar;
  return Math.min(MAX_WAIFU_SEGMENT_DELAY_MS, Math.max(MIN_WAIFU_SEGMENT_DELAY_MS, computed));
}

function clearWaifuDisplayTimers() {
  waifuDisplayTimers.forEach((timer) => window.clearTimeout(timer));
  waifuDisplayTimers = [];
}

function renderMessageContent(message) {
  const text = String(message?.content || "");
  const settings = getSelectedWaifuSettings();
  if (message?.role !== "assistant" || !settings.enabled) {
    return `<div class="message-content">${escapeHtml(text)}</div>`;
  }
  const segments = splitWaifuSegments(text);
  if (segments.length <= 1) {
    const displayText = settings.removePunctuation ? stripDisplayPunctuation(text) : text;
    return `<div class="message-content">${escapeHtml(displayText)}</div>`;
  }
  const shouldDelay = message.waifuDisplayPending === true;
  return `<div class="message-content">${segments.map((segment, index) => {
    const displayText = settings.removePunctuation ? stripDisplayPunctuation(segment) : segment;
    return `<span class="message-segment" ${shouldDelay && index > 0 ? "hidden" : ""}>${escapeHtml(displayText)}</span>`;
  }).join("")}</div>`;
}

function scheduleWaifuSegments() {
  clearWaifuDisplayTimers();
  const settings = getSelectedWaifuSettings();
  if (!settings.enabled || !els.messages) return;
  let maxDelay = 0;
  els.messages.querySelectorAll(".message.assistant .message-segment[hidden]").forEach((segment) => {
    let previousText = "";
    let previous = segment.previousElementSibling;
    while (previous) {
      previousText = `${previous.textContent || ""}${previousText}`;
      previous = previous.previousElementSibling;
    }
    const delay = getWaifuSegmentDelay(previousText || segment.textContent || "", settings);
    maxDelay = Math.max(maxDelay, delay);
    const timer = window.setTimeout(() => {
      segment.hidden = false;
      els.messages.scrollTop = els.messages.scrollHeight;
    }, delay);
    waifuDisplayTimers.push(timer);
  });
  if (maxDelay > 0) {
    const clearTimer = window.setTimeout(() => {
      let clearedPendingFlag = false;
      state.messages.forEach((message) => {
        if (message?.waifuDisplayPending) {
          message.waifuDisplayPending = false;
          markWaifuMessageDisplayed(message);
          clearedPendingFlag = true;
        }
      });
      if (clearedPendingFlag) renderMessages();
    }, maxDelay + 60);
    waifuDisplayTimers.push(clearTimer);
  }
}

function parseRuntimeCommandList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return list
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeRuntimeProjectSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const mode = String(source.mode || source.agentMode || "").trim();
  return {
    mode,
    agentMode: String(source.agentMode || mode).trim(),
    workDir: String(source.workDir || source.work_dir || "").trim(),
    showContextIndicator: (source.showContextIndicator ?? source.show_context_indicator) === undefined
      ? true
      : normalizeRuntimeBoolean(source.showContextIndicator ?? source.show_context_indicator),
    replyFooter: (source.replyFooter ?? source.reply_footer) === undefined
      ? true
      : normalizeRuntimeBoolean(source.replyFooter ?? source.reply_footer),
    adminFrom: String(source.adminFrom ?? source.admin_from ?? "").trim(),
    disabledCommands: parseRuntimeCommandList(source.disabledCommands ?? source.disabled_commands),
  };
}

function setCompanionRuntimeSettings(nextState) {
  state.companionRuntimeSettings = {
    threadId: "",
    phase: "idle",
    available: false,
    project: "",
    reason: "",
    error: "",
    settings: null,
    ...nextState,
  };
}

function getCompanionRuntimeControls() {
  return [
    els.companionRuntimeReplyFooter,
    els.companionRuntimeContextIndicator,
    els.companionRuntimeWorkDir,
    els.companionRuntimeDisabledCommands,
    els.companionRuntimeAdminFrom,
  ].filter(Boolean);
}

function setRuntimeInputValue(input, value) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function syncCompanionAgentModeFromRuntimeSettings(settings) {
  const mode = String(settings?.mode || settings?.agentMode || "").trim();
  if (!mode || !els.companionAgentMode) return;
  const agentType = els.companionAgentType?.value || getSelectedThread()?.runtime?.agentType || "codex";
  const selectedMode = normalizeAgentPermissionMode(mode, agentType);
  const option = Array.from(els.companionAgentMode.options || [])
    .find((item) => item.value === selectedMode || item.value === mode);
  if (option) {
    els.companionAgentMode.value = option.value;
  }
}

function renderCompanionRuntimeSettings({ preserveControlValues = false } = {}) {
  if (!els.companionRuntimeStatus) return;
  const isCreating = state.companionDrawerMode === "create";
  const thread = getSelectedThread();
  const threadId = isCreating ? "" : String(thread?.id || state.selectedThreadId || "").trim();
  const runtimeState = state.companionRuntimeSettings.threadId === threadId ? state.companionRuntimeSettings : null;
  const settings = runtimeState?.settings || null;
  const project = String(runtimeState?.project || thread?.runtime?.project || "").trim();
  let phase = runtimeState?.phase || "idle";
  let statusText = "未加载";

  if (isCreating) {
    phase = "creating";
    statusText = "创建后可用";
  } else if (!threadId) {
    phase = "unavailable";
    statusText = "缺少 thread";
  } else if (phase === "loading") {
    statusText = project ? `加载中 · ${project}` : "加载中";
  } else if (phase === "available" && settings) {
    statusText = project ? `已加载 · ${project}` : "已加载";
  } else if (phase === "error") {
    statusText = runtimeState?.error ? `错误 · ${runtimeState.error}` : "读取失败";
  } else if (phase === "unavailable") {
    statusText = runtimeState?.reason || "Runtime 项目不可用";
  }

  els.companionRuntimeStatus.textContent = statusText;
  els.companionRuntimeStatus.classList.toggle("runtime-status-ready", phase === "available");
  els.companionRuntimeStatus.classList.toggle("runtime-status-loading", phase === "loading" || companionRuntimeSaving);
  els.companionRuntimeStatus.classList.toggle("runtime-status-error", phase === "error");
  els.companionRuntimeStatus.classList.toggle("runtime-status-unavailable", phase === "unavailable" || phase === "creating");

  if (!preserveControlValues) {
    if (els.companionRuntimeReplyFooter) {
      els.companionRuntimeReplyFooter.checked = Boolean(settings?.replyFooter);
    }
    if (els.companionRuntimeContextIndicator) {
      els.companionRuntimeContextIndicator.checked = Boolean(settings?.showContextIndicator);
    }
    setRuntimeInputValue(els.companionRuntimeWorkDir, settings?.workDir || thread?.runtime?.workspaceDir || "");
    setRuntimeInputValue(els.companionRuntimeDisabledCommands, settings?.disabledCommands?.join(", ") || "");
    setRuntimeInputValue(els.companionRuntimeAdminFrom, settings?.adminFrom || "");
  }

  const runtimeControlsDisabled = companionRuntimeSaving
    || isCreating
    || phase === "loading"
    || phase !== "available"
    || !settings;
  getCompanionRuntimeControls().forEach((control) => {
    control.disabled = runtimeControlsDisabled;
  });
  if (els.companionAgentMode) {
    els.companionAgentMode.disabled = companionRuntimeSaving || isCreating || phase === "loading";
  }
}

async function loadCompanionRuntimeSettings(threadId, { force = false } = {}) {
  const targetThreadId = String(threadId || "").trim();
  const requestId = companionRuntimeRequestId + 1;

  if (!targetThreadId) {
    companionRuntimeRequestId = requestId;
    setCompanionRuntimeSettings({
      threadId: "",
      phase: "unavailable",
      reason: "当前联系人缺少 thread。",
    });
    renderCompanionRuntimeSettings();
    return state.companionRuntimeSettings;
  }

  if (!force
    && state.companionRuntimeSettings.threadId === targetThreadId
    && ["available", "unavailable", "error"].includes(state.companionRuntimeSettings.phase)) {
    renderCompanionRuntimeSettings();
    return state.companionRuntimeSettings;
  }

  companionRuntimeRequestId = requestId;
  const thread = state.threads.find((item) => item.id === targetThreadId) || getSelectedThread();
  const previousSettings = state.companionRuntimeSettings.threadId === targetThreadId
    ? state.companionRuntimeSettings.settings
    : null;
  setCompanionRuntimeSettings({
    threadId: targetThreadId,
    phase: "loading",
    project: thread?.runtime?.project || "",
    settings: previousSettings,
  });
  renderCompanionRuntimeSettings();

  try {
    const result = await apiGet(`/api/threads/${encodeURIComponent(targetThreadId)}/runtime-project-settings`);
    if (companionRuntimeRequestId !== requestId) return null;

    if (result?.available && result?.settings) {
      const settings = normalizeRuntimeProjectSettings(result.settings);
      setCompanionRuntimeSettings({
        threadId: targetThreadId,
        phase: "available",
        available: true,
        project: String(result.project || thread?.runtime?.project || "").trim(),
        settings,
      });
      syncCompanionAgentModeFromRuntimeSettings(settings);
      renderCompanionRuntimeSettings();
      return state.companionRuntimeSettings;
    }

    setCompanionRuntimeSettings({
      threadId: targetThreadId,
      phase: "unavailable",
      project: String(result?.project || thread?.runtime?.project || "").trim(),
      reason: String(result?.reason || "21040 Runtime 项目不可用。").trim(),
      settings: null,
    });
    renderCompanionRuntimeSettings();
    return state.companionRuntimeSettings;
  } catch (error) {
    if (companionRuntimeRequestId !== requestId) return null;
    setCompanionRuntimeSettings({
      threadId: targetThreadId,
      phase: "error",
      project: thread?.runtime?.project || "",
      error: error instanceof Error ? error.message : String(error),
      settings: previousSettings,
    });
    renderCompanionRuntimeSettings();
    return state.companionRuntimeSettings;
  }
}

function buildCompanionRuntimeSettingsPayload() {
  const settings = state.companionRuntimeSettings.available
    ? state.companionRuntimeSettings.settings
    : null;
  return {
    mode: String(els.companionAgentMode?.value || "").trim(),
    workDir: els.companionRuntimeWorkDir?.value.trim() || "",
    showContextIndicator: Boolean(els.companionRuntimeContextIndicator?.checked),
    replyFooter: Boolean(els.companionRuntimeReplyFooter?.checked),
    adminFrom: els.companionRuntimeAdminFrom?.value.trim() || "",
    disabledCommands: parseRuntimeCommandList(els.companionRuntimeDisabledCommands?.value || ""),
  };
}

async function saveCompanionRuntimeSettingsIfAvailable(threadId, payload) {
  const targetThreadId = String(threadId || "").trim();
  if (!targetThreadId || state.companionRuntimeSettings.threadId !== targetThreadId || !state.companionRuntimeSettings.available) {
    return false;
  }

  let preserveControlValues = true;
  companionRuntimeSaving = true;
  renderCompanionRuntimeSettings({ preserveControlValues: true });
  try {
    const result = await apiPatch(`/api/threads/${encodeURIComponent(targetThreadId)}/runtime-project-settings`, payload);
    if (result?.available && result?.settings) {
      const settings = normalizeRuntimeProjectSettings(result.settings);
      preserveControlValues = false;
      setCompanionRuntimeSettings({
        threadId: targetThreadId,
        phase: "available",
        available: true,
        project: String(result.project || state.companionRuntimeSettings.project || "").trim(),
        settings,
      });
      syncCompanionAgentModeFromRuntimeSettings(settings);
      return true;
    }

    preserveControlValues = false;
    setCompanionRuntimeSettings({
      threadId: targetThreadId,
      phase: "unavailable",
      project: String(result?.project || state.companionRuntimeSettings.project || "").trim(),
      reason: String(result?.reason || "21040 Runtime 项目不可用。").trim(),
      settings: null,
    });
    return false;
  } catch (error) {
    setCompanionRuntimeSettings({
      threadId: targetThreadId,
      phase: "error",
      project: state.companionRuntimeSettings.project || "",
      error: error instanceof Error ? error.message : String(error),
      settings: state.companionRuntimeSettings.settings,
    });
    throw error;
  } finally {
    companionRuntimeSaving = false;
    renderCompanionRuntimeSettings({ preserveControlValues });
  }
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
    setCompanionRuntimeSettings({
      threadId: thread.id,
      phase: "loading",
      project: thread.runtime?.project || "",
      settings: state.companionRuntimeSettings.threadId === thread.id ? state.companionRuntimeSettings.settings : null,
    });
    renderCompanionRuntimeSettings();
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
    const workflowConfig = extractContactWorkflowConfig(contact);
    const workflowPersona = workflowConfig.workflowInput?.contactPersona;
    els.companionPersona.value =
      workflowPersona != null && String(workflowPersona).trim() !== ""
        ? String(workflowPersona)
        : contact.character?.persona || "";
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
    const waifuSettings = getWaifuSettingsForContact(contact.id);
    const timeSettings = normalizeTimeSettings(thread.timeSettings || contact.timeSettings || {});
    if (els.companionWaifuTextMode) els.companionWaifuTextMode.checked = waifuSettings.enabled;
    if (els.companionWaifuRemovePunctuation) els.companionWaifuRemovePunctuation.checked = waifuSettings.removePunctuation;
    if (els.companionWaifuDelay) els.companionWaifuDelay.value = String(waifuSettings.typingDelayMsPerChar);
    if (els.companionWaifuDelayValue) els.companionWaifuDelayValue.textContent = `${waifuSettings.typingDelayMsPerChar} ms/字`;
    if (els.companionTimeInjectionEnabled) els.companionTimeInjectionEnabled.checked = timeSettings.enabled;
    if (els.companionTimezone) els.companionTimezone.value = timeSettings.timezone;
    if (els.companionAgentType) els.companionAgentType.value = permissions?.agentType || thread.runtime?.agentType || "codex";
    if (els.companionRoleLevel) els.companionRoleLevel.value = contact.roleLevel || thread.roleLevel || "contact";
    populateCompanionAgentModeOptions(
      permissions?.agentMode || "",
      els.companionAgentType?.value || "codex",
      permissions?.agentCapabilities?.modes,
    );
    hydrateCompanionWorkflowFromContact(contact);
    renderCompanionWorkflowSection({ preserveValues: true });
    await loadCompanionRuntimeSettings(thread.id, { force: true });
  } else {
    state.editingContactId = "";
    els.companionForm.reset();
    const timeSettings = normalizeTimeSettings({ timezone: getBrowserTimezone() });
    if (els.companionWaifuTextMode) els.companionWaifuTextMode.checked = false;
    if (els.companionWaifuRemovePunctuation) els.companionWaifuRemovePunctuation.checked = false;
    if (els.companionWaifuDelay) els.companionWaifuDelay.value = String(DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
    if (els.companionWaifuDelayValue) els.companionWaifuDelayValue.textContent = `${DEFAULT_WAIFU_DELAY_MS_PER_CHAR} ms/字`;
    if (els.companionTimeInjectionEnabled) els.companionTimeInjectionEnabled.checked = false;
    if (els.companionTimezone) els.companionTimezone.value = timeSettings.timezone;
    if (els.companionAgentType) els.companionAgentType.value = "codex";
    if (els.companionRoleLevel) els.companionRoleLevel.value = "contact";
    populateCompanionAgentModeOptions("suggest", "codex");
    hydrateCompanionWorkflowFromContact(null);
    renderCompanionWorkflowSection({ preserveValues: false });
    setCompanionRuntimeSettings({
      threadId: "",
      phase: "creating",
      reason: "创建联系人后可编辑 21040 Runtime。",
    });
    renderCompanionRuntimeSettings();
  }
}

function closeCompanionDrawer() {
  els.companionDrawer.classList.add("hidden");
  els.companionDrawer.setAttribute("aria-hidden", "true");
  state.editingContactId = "";
  if (els.companionWorkflowFields) els.companionWorkflowFields.innerHTML = "";
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
  const timeSettings = normalizeTimeSettings({
    enabled: els.companionTimeInjectionEnabled?.checked,
    timezone: els.companionTimezone?.value,
  });
  const selectedWorkflow = getSelectedWorkflowFromDrawer();
  const workflowInput = buildWorkflowInputFromDrawer(selectedWorkflow);
  const toolAllow = els.companionToolAllow.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const base = compactObject({
    name: els.companionName.value.trim(),
    displayName: els.companionDisplayName.value.trim(),
    avatar: els.companionAvatar.value.trim(),
    style: els.companionStyle.value.trim(),
    threadSummary: els.companionThreadSummary.value.trim(),
    greeting: els.companionGreeting.value.trim(),
    agentType: els.companionAgentType?.value || "codex",
    roleLevel: els.companionRoleLevel?.value || "contact",
    agentMode: els.companionAgentMode?.value || "",
    timeSettings,
    // Keep workflow fields out of compactObject so empty strings don't get dropped silently.
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
  if (selectedWorkflow && workflowInput && Object.keys(workflowInput).length) {
    base.workflowId = selectedWorkflow.id || "";
    base.workflowVersion = selectedWorkflow.version || "";
    base.workflowInput = workflowInput;
  }
  return base;
}

function hydrateCompanionWorkflowFromContact(contact) {
  // Populate select based on contact's current workflow, falling back to first workflow.
  populateCompanionWorkflowOptions();
  const current = extractContactWorkflowConfig(contact);
  const match = current.workflowId
    ? findWorkflowByIdVersion(current.workflowId, current.workflowVersion)
    : null;
  const fallback = state.workflows?.[0] || null;
  const pick = match || fallback;
  if (els.companionWorkflowSelect) {
    els.companionWorkflowSelect.value = pick ? buildWorkflowKey(pick) : "";
  }
  // Store existing workflowInput for later render
  els.companionWorkflowFields?.setAttribute("data-seed", JSON.stringify(current.workflowInput || {}));
}

function renderCompanionWorkflowSection({ preserveValues = false } = {}) {
  populateCompanionWorkflowOptions();
  const meta = state.workflowsMeta || {};
  const count = Array.isArray(state.workflows) ? state.workflows.length : 0;
  if (els.companionWorkflowStatus) {
    els.companionWorkflowStatus.textContent =
      meta.phase === "loading"
        ? "加载中…"
        : meta.phase === "error"
          ? "加载失败"
          : meta.phase === "loaded"
            ? `${count} 个`
            : "未加载";
  }

  const selected = getSelectedWorkflowFromDrawer();
  if (els.companionWorkflowMeta) {
    els.companionWorkflowMeta.textContent = selected
      ? `${selected.id}${selected.version ? ` · v${selected.version}` : ""}`
      : meta.phase === "error"
        ? `workflows error: ${meta.error || "-"}`
        : "未选择 workflow";
  }
  if (!els.companionWorkflowFields) return;

  const seed = readWorkflowSeedInput();
  if (!seed || !Object.keys(seed).length) {
    els.companionWorkflowFields.innerHTML = "";
    if (els.companionPersona) {
      els.companionPersona.classList.add("hidden");
      els.companionPersona.readOnly = true;
    }
    return;
  }
  const schema = normalizeJsonSchema(selected?.contactConfigSchema) || null;
  const next = renderWorkflowInputFieldsHtml(schema, seed, { preserveValues });
  els.companionWorkflowFields.innerHTML = next.html;
  if (next.initValues && typeof next.initValues === "object") {
    Object.entries(next.initValues).forEach(([key, value]) => {
      const node = els.companionWorkflowFields.querySelector(`[data-workflow-key="${cssEscape(key)}"]`);
      if (!node) return;
      if (node.type === "checkbox") {
        node.checked = Boolean(value);
      } else {
        node.value = value == null ? "" : String(value);
      }
    });
  }

  // Avoid a visible-but-ignored editable persona textarea:
  // - If the workflow exposes `contactPersona`, the workflow field is the source of truth; hide the legacy textarea.
  // - If the workflow does not expose it, only show the legacy textarea when a workflow is selected (because payload
  //   intentionally omits workflowInput when no workflow is selected).
  if (els.companionPersona) {
    const workflowPersonaControl = els.companionWorkflowFields.querySelector('[data-workflow-key="contactPersona"]');
    const showLegacyPersona = Boolean(selected) && !workflowPersonaControl;
    els.companionPersona.classList.toggle("hidden", !showLegacyPersona);
    els.companionPersona.readOnly = !showLegacyPersona;
    if (showLegacyPersona && String(els.companionPersona.value || "").trim() === "") {
      const seeded = seed && typeof seed === "object" ? seed.contactPersona : "";
      if (seeded != null && String(seeded).trim() !== "") {
        els.companionPersona.value = String(seeded);
      }
    }
  }
}

function populateCompanionWorkflowOptions() {
  if (!els.companionWorkflowSelect) return;
  const workflows = Array.isArray(state.workflows) ? state.workflows : [];
  if (!workflows.length) {
    els.companionWorkflowSelect.innerHTML = `<option value="">(无可用 workflow)</option>`;
    return;
  }
  const currentValue = els.companionWorkflowSelect.value;
  els.companionWorkflowSelect.innerHTML = workflows
    .map((wf) => {
      const key = buildWorkflowKey(wf);
      const label = wf.version ? `${wf.label} · v${wf.version}` : wf.label;
      return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (currentValue) {
    const exists = workflows.some((wf) => buildWorkflowKey(wf) === currentValue);
    if (exists) els.companionWorkflowSelect.value = currentValue;
  }
}

function buildWorkflowKey(workflow) {
  if (!workflow) return "";
  const id = String(workflow.id || "").trim();
  const version = String(workflow.version || "").trim();
  return `${id}::${version}`;
}

function parseWorkflowKey(value) {
  const raw = String(value || "");
  const [id, version] = raw.split("::");
  return { id: String(id || "").trim(), version: String(version || "").trim() };
}

function findWorkflowByIdVersion(id, version) {
  const workflows = Array.isArray(state.workflows) ? state.workflows : [];
  const idKey = String(id || "").trim();
  const verKey = String(version || "").trim();
  if (!idKey) return null;
  const exact = workflows.find((wf) => wf.id === idKey && String(wf.version || "").trim() === verKey);
  if (exact) return exact;
  const loose = workflows.find((wf) => wf.id === idKey);
  return loose || null;
}

function getSelectedWorkflowFromDrawer() {
  if (!els.companionWorkflowSelect) return null;
  const { id, version } = parseWorkflowKey(els.companionWorkflowSelect.value);
  return findWorkflowByIdVersion(id, version) || null;
}

function extractContactWorkflowConfig(contact) {
  const c = contact && typeof contact === "object" ? contact : null;
  const workflowId =
    String(c?.workflowId || c?.workflow?.id || c?.workflow?.workflowId || c?.character?.workflowId || "").trim() || "";
  const workflowVersion =
    String(c?.workflowVersion || c?.workflow?.version || c?.workflow?.workflowVersion || c?.character?.workflowVersion || "").trim() ||
    "";
  const workflowInputRaw =
    c?.workflowInput ||
    c?.workflow?.input ||
    c?.workflow?.workflowInput ||
    c?.character?.workflowInput ||
    c?.character?.workflowInput ||
    {};
  const workflowInput = workflowInputRaw && typeof workflowInputRaw === "object" ? workflowInputRaw : {};
  return { workflowId, workflowVersion, workflowInput };
}

function readWorkflowSeedInput() {
  try {
    const raw = els.companionWorkflowFields?.getAttribute("data-seed") || "";
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function renderWorkflowInputFieldsHtml(schema, seed, { preserveValues } = {}) {
  const s = normalizeJsonSchema(schema);
  const properties = s?.properties && typeof s.properties === "object" ? s.properties : {};
  const required = new Set(Array.isArray(s?.required) ? s.required.map((k) => String(k)) : []);
  const keys = Object.keys(properties);

  if (!keys.length) {
    return {
      html: `<article class="card"><div>该 workflow 未暴露 contactConfigSchema 字段。</div></article>`,
      initValues: {},
    };
  }

  const preserved = preserveValues ? readWorkflowInputFromControls() : {};
  const initValues = compactWorkflowInput({
    ...(seed && typeof seed === "object" ? seed : {}),
    ...(preserveValues ? preserved : {}),
  });

  const rows = keys
    .map((key) => {
      const fieldSchema = normalizeJsonSchema(properties[key]) || {};
      const title = String(fieldSchema.title || fieldSchema.name || key).trim();
      const desc = String(fieldSchema.descriptionZh || fieldSchema.description || "").trim();
      const enumValues = Array.isArray(fieldSchema.enum) ? fieldSchema.enum : null;
      const type = String(fieldSchema.type || "").trim();
      const format = String(fieldSchema.format || "").trim();

      const fieldId = `workflow-input-${key}`;
      const req = required.has(String(key));
      const helpBits = [];
      const src = resolveSchemaMeta(fieldSchema, ["source", "inputSource", "from", "origin", "x-source"]);
      const rule = resolveSchemaMeta(fieldSchema, ["rule", "rules", "x-rule", "x-rules", "pattern"]);
      if (src) helpBits.push(`source:${src}`);
      if (rule) helpBits.push(`rule:${rule}`);

      let inputHtml = "";
      if (enumValues && enumValues.length) {
        inputHtml = `
          <select id="${escapeHtml(fieldId)}" data-workflow-key="${escapeHtml(key)}" ${req ? "required" : ""}>
            <option value=""></option>
            ${enumValues.map((item) => `<option value="${escapeHtml(String(item))}">${escapeHtml(String(item))}</option>`).join("")}
          </select>
        `;
      } else if (type === "boolean") {
        inputHtml = `
          <label class="runtime-toggle-row">
            <input id="${escapeHtml(fieldId)}" type="checkbox" data-workflow-key="${escapeHtml(key)}" />
            <span>${escapeHtml(title)}</span>
          </label>
        `;
      } else if (type === "number" || type === "integer") {
        const step = type === "integer" ? "1" : "any";
        inputHtml = `<input id="${escapeHtml(fieldId)}" type="number" step="${step}" data-workflow-key="${escapeHtml(key)}" ${req ? "required" : ""} />`;
      } else {
        const shouldTextarea = format === "textarea" || format === "multiline" || (fieldSchema.maxLength != null && Number(fieldSchema.maxLength) > 180);
        inputHtml = shouldTextarea
          ? `<textarea id="${escapeHtml(fieldId)}" rows="3" data-workflow-key="${escapeHtml(key)}" ${req ? "required" : ""}></textarea>`
          : `<input id="${escapeHtml(fieldId)}" data-workflow-key="${escapeHtml(key)}" ${req ? "required" : ""} />`;
      }

      const labelHtml =
        type === "boolean"
          ? ""
          : `<div class="workflow-field-help">${escapeHtml([helpBits.join(" · "), desc].filter(Boolean).join(" · "))}</div>`;

      return `
        <div class="workflow-field">
          ${type === "boolean"
            ? `${inputHtml}${desc || helpBits.length ? `<div class="workflow-field-help">${escapeHtml([helpBits.join(" · "), desc].filter(Boolean).join(" · "))}</div>` : ""}`
            : `<label class="form-field" for="${escapeHtml(fieldId)}"><span>${escapeHtml(title)}${req ? " *" : ""}</span>${inputHtml}</label>${labelHtml}`}
        </div>
      `;
    })
    .join("");

  return { html: rows, initValues };
}

function readWorkflowInputFromControls() {
  if (!els.companionWorkflowFields) return {};
  const output = {};
  els.companionWorkflowFields.querySelectorAll("[data-workflow-key]").forEach((node) => {
    const key = String(node.dataset.workflowKey || "").trim();
    if (!key) return;
    if (node.type === "checkbox") {
      output[key] = Boolean(node.checked);
      return;
    }
    const value = String(node.value ?? "").trim();
    if (value === "") return;
    if (node.type === "number") {
      const number = Number(value);
      if (Number.isFinite(number)) output[key] = number;
      return;
    }
    output[key] = value;
  });
  return output;
}

function compactWorkflowInput(input) {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => {
      if (!key) return false;
      if (value == null) return false;
      if (typeof value === "string") return value.trim() !== "";
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }),
  );
}

function buildWorkflowInputFromDrawer(selectedWorkflow) {
  const input = { ...readWorkflowInputFromControls() };
  // Contract requires at least these keys.
  if (!Object.prototype.hasOwnProperty.call(input, "contactProjectDir")) {
    const fallback = String(els.companionRuntimeWorkDir?.value || "").trim();
    if (fallback) input.contactProjectDir = fallback;
  }
  if (!Object.prototype.hasOwnProperty.call(input, "contactPersona")) {
    const fallback = String(els.companionPersona?.value || "").trim();
    if (fallback) input.contactPersona = fallback;
  }
  if (!Object.prototype.hasOwnProperty.call(input, "userPersona")) {
    const fallback = String(state.bootstrap?.userPersona || state.bootstrap?.user?.persona || "").trim();
    if (fallback) input.userPersona = fallback;
  }

  // If workflow isn't selected, keep workflowInput empty to avoid surprising payloads.
  if (!selectedWorkflow) return {};
  return compactWorkflowInput(input);
}

function cssEscape(value) {
  // Minimal escape for attribute selector usage in querySelector.
  return String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function populateCompanionAgentModeOptions(selectedMode, agentType, runtimeModes) {
  if (!els.companionAgentMode) return;
  const modes = normalizeAgentModeOptions(runtimeModes) || getAgentModeOptions(agentType);
  const selected = selectedMode || modes[0]?.key || "";
  els.companionAgentMode.innerHTML = modes
    .map((mode) => `<option value="${escapeHtml(mode.key)}" ${mode.key === selected ? "selected" : ""}>${escapeHtml(mode.label)}</option>`)
    .join("");
}

function normalizeAgentPermissionMode(value, agentType) {
  const modes = getAgentModeOptions(agentType);
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    autoedit: "auto-edit",
    fullauto: "full-auto",
    bypasspermissions: "bypassPermissions",
    bypass: "bypassPermissions",
    yolo: agentType === "claudecode" ? "bypassPermissions" : "yolo",
  };
  const candidate = aliases[normalized.replaceAll("-", "")] || aliases[normalized] || raw;
  const found = modes.find((mode) => mode.key === candidate || mode.key.toLowerCase() === normalized);
  return found?.key || raw;
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
