export const views = document.querySelectorAll('.view');
export const tabs = document.querySelectorAll('.tab');
export const panel = document.querySelector('#feature-panel');
export const panelViews = document.querySelectorAll('.panel-view');
export const panelTitle = document.querySelector('#panel-title');
export const panelEyebrow = document.querySelector('#panel-eyebrow');
export const panelBackButton = document.querySelector('#panel-back-button');
export const closePanelButton = document.querySelector('#close-panel');

function selectAny(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function selectAllAny(selectors) {
  for (const selector of selectors) {
    const list = document.querySelectorAll(selector);
    if (list?.length) return list;
  }
  return document.querySelectorAll('[data-dom-empty-node-list]');
}

export const safeQuery = (selector) => document.querySelector(selector);
export const safeQueryAll = (selector) => document.querySelectorAll(selector);
export const lockScreen = document.querySelector('#lock-screen');
export const desktopScreen = document.querySelector('#desktop-screen');
export const unlockButton = document.querySelector('#unlock-button');
export const enterAppButton = document.querySelector('#enter-app-button');
export const relockButton = document.querySelector('#relock-button');
export const lockDate = document.querySelector('#lock-date');
export const lockTime = document.querySelector('#lock-time');
export const lockNoticeTitle = document.querySelector('#lock-notice-title');
export const lockNoticeText = document.querySelector('#lock-notice-text');
export const desktopUnread = document.querySelector('#desktop-unread');
export const desktopGreeting = document.querySelector('#desktop-greeting');
export const desktopWeather = document.querySelector('#desktop-weather');
export const desktopPagesViewport = document.querySelector('#desktop-pages-viewport');
export const desktopPages = document.querySelector('#desktop-pages');
export const desktopPagination = document.querySelector('#desktop-pagination');
export const desktopDots = document.querySelectorAll('[data-desktop-dot]');
export const desktopCameraApp = document.querySelector('#desktop-camera-app');
export const dockCameraApp = document.querySelector('#dock-camera-app');
export let backButton = document.querySelector('[data-back]');
export let chatForm = document.querySelector('#chat-form');
export let chatInput = document.querySelector('#chat-input');
export let chatInputShell = document.querySelector('.chat-input-shell');
export let slashCommandPalette = document.querySelector('#slash-command-palette');
export let runtimePassThroughToggle = document.querySelector('#runtime-pass-through-toggle');
export let attachmentButton = document.querySelector('#attachment-button');
export let chatAttachmentInput = document.querySelector('#chat-attachment-input');
export let attachmentStrip = document.querySelector('#attachment-strip');
export let magicWandButton = document.querySelector('#magic-wand-button');
export let chatThread = document.querySelector('#chat-thread');
export let chatHeaderAvatar = document.querySelector('#chat-header-avatar');
export let chatTitle = document.querySelector('#chat-title');
export let chatSubtitle = document.querySelector('#chat-subtitle');
export const statusTime = document.querySelector('#status-time');
export const themeLabel = document.querySelector('#theme-label');
export const appExitButton = document.querySelector('#app-exit-button');
export let markReadButton = document.querySelector('#mark-read-button');
export const addContactButton = document.querySelector('#add-contact-button');
export let chatStatus = document.querySelector('#chat-status');
export const registeredAppViews = document.querySelector('#registered-app-views');
export const dynamicAppEyebrow = document.querySelector('#dynamic-app-eyebrow');
export const dynamicAppTitle = document.querySelector('#dynamic-app-title');
export const dynamicAppStatus = document.querySelector('#dynamic-app-status');
export const dynamicAppFrame = document.querySelector('#dynamic-app-frame');
export const dynamicAppEmpty = document.querySelector('#dynamic-app-empty');

export let messageList = document.querySelector('#message-list');
export let messageOverview = selectAny(['#message-overview', '[data-message-overview]', '.message-overview']);
export let messageOverviewTitle = selectAny(['#message-overview-title', '[data-message-overview-title]']);
export let messageOverviewSubtitle = selectAny(['#message-overview-subtitle', '[data-message-overview-subtitle]']);
export let messageOverviewBadge = selectAny(['#message-overview-badge', '[data-message-overview-badge]', '.message-overview-badge']);
export const messageSearchInput = selectAny(['#message-search', '#message-search-input', '[data-message-search]', 'input[name="message-search"]']);
export const messageFilterControls = selectAny(['#message-filter-controls', '[data-message-filters]', '.message-filter-controls']);
export const messageFilterButtons = selectAllAny(['[data-message-filter]', '[data-message-filter-kind]', '.message-filter [data-filter]', '.message-filter-button']);

export function refreshDynamicDomBindings() {
  backButton = document.querySelector('[data-back]');
  chatForm = document.querySelector('#chat-form');
  chatInput = document.querySelector('#chat-input');
  chatInputShell = document.querySelector('.chat-input-shell');
  slashCommandPalette = document.querySelector('#slash-command-palette');
  runtimePassThroughToggle = document.querySelector('#runtime-pass-through-toggle');
  attachmentButton = document.querySelector('#attachment-button');
  chatAttachmentInput = document.querySelector('#chat-attachment-input');
  attachmentStrip = document.querySelector('#attachment-strip');
  magicWandButton = document.querySelector('#magic-wand-button');
  chatThread = document.querySelector('#chat-thread');
  chatHeaderAvatar = document.querySelector('#chat-header-avatar');
  chatTitle = document.querySelector('#chat-title');
  chatSubtitle = document.querySelector('#chat-subtitle');
  markReadButton = document.querySelector('#mark-read-button');
  chatStatus = document.querySelector('#chat-status');
  messageList = document.querySelector('#message-list');
  messageOverview = selectAny(['#message-overview', '[data-message-overview]', '.message-overview']);
  messageOverviewTitle = selectAny(['#message-overview-title', '[data-message-overview-title]']);
  messageOverviewSubtitle = selectAny(['#message-overview-subtitle', '[data-message-overview-subtitle]']);
  messageOverviewBadge = selectAny(['#message-overview-badge', '[data-message-overview-badge]', '.message-overview-badge']);
}
export const contactList = document.querySelector('#contact-list');
export const contactOverview = selectAny(['#contact-overview', '[data-contact-overview]', '.contact-overview']);
export const contactSearchInput = selectAny(['#contact-search', '#contact-search-input', '[data-contact-search]', 'input[name="contact-search"]']);
export const contactFilterControls = selectAny(['#contact-filter-controls', '[data-contact-filters]', '.contact-filter-controls']);
export const contactCategorySelect = selectAny(['#contact-category', '#contact-category-select', '[data-contact-category]']);
export const contactCategoryButtons = selectAllAny(['[data-contact-category]', '[data-contact-segment]', '.contact-category [data-category]']);
export const momentsList = document.querySelector('#moments-list');
export const momentsMainList = document.querySelector('#moments-main-list');
export const forumList = document.querySelector('#forum-list');
export const memoryList = document.querySelector('#memory-list');
export const journalList = document.querySelector('#journal-list');
export const characterHighlight = document.querySelector('#character-highlight');
export const permissionContactSelect = document.querySelector('#permission-contact-select');
export const permissionPanelSummary = selectAny([
  '#permission-panel-summary',
  '[data-permission-panel-summary]',
  '[data-permission-summary]',
]);
export const permissionPanelSource = selectAny([
  '#permission-panel-source',
  '[data-permission-panel-source]',
  '[data-permission-source]',
]);
export const permissionTemplateGrid = document.querySelector('#permission-template-grid');
export const permissionDecisionStack = document.querySelector('#permission-decision-stack');
export const permissionCapabilitiesContainer = selectAny([
  '#permission-capabilities',
  '[data-permission-capabilities]',
  '.permission-capabilities',
]);
export const permissionCapabilityCards = selectAllAny([
  '[data-permission-capability]',
  '[data-capability]',
  '.permission-capability',
]);

export const memoryForm = document.querySelector('#memory-form');
export const memoryInput = document.querySelector('#memory-input');
export const momentsForm = document.querySelector('#moments-form');
export const momentsInput = document.querySelector('#moments-input');
export const momentsMainForm = document.querySelector('#moments-main-form');
export const momentsMainInput = document.querySelector('#moments-main-input');
export const forumForm = document.querySelector('#forum-form');
export const forumTitle = document.querySelector('#forum-title');
export const forumInput = document.querySelector('#forum-input');
export const journalForm = document.querySelector('#journal-form');
export const journalTitle = document.querySelector('#journal-title');
export const journalInput = document.querySelector('#journal-input');
export const settingsForm = document.querySelector('#settings-form');
export const settingsSecondaryActions = selectAllAny([
  '[data-panel="settings"] .secondary-button',
  '[data-settings-secondary-action]',
  '#settings-secondary-actions button',
]);
export const settingsDetailsContainer = selectAny([
  '#settings-details',
  '[data-settings-details]',
  '[data-panel="settings"] .settings-details',
]);
export const settingsInfoCards = selectAllAny([
  '[data-panel="settings"] .info-card',
  '[data-settings-info-card]',
]);
export const themeSelect = document.querySelector('#theme-select');
export const apiNameInput = document.querySelector('#api-name');
export const apiUrlInput = document.querySelector('#api-url');
export const apiKeyInput = document.querySelector('#api-key');
export const modelNameInput = document.querySelector('#model-name');
export const temperatureInput = document.querySelector('#temperature');
export const maxTokensInput = document.querySelector('#max-tokens');
export const appManagerForm = document.querySelector('#app-manager-form');
export const appManagerActions = selectAny(['.app-manager-actions', '#app-manager-actions', '[data-app-manager-actions]']);
export const appManagerCards = selectAllAny(['[data-app-manager-card]', '.app-manager-card', '[data-panel="app-manager"] .info-card']);
export const appManagerStatusElements = selectAllAny([
  '#service-manager-status',
  '#app-registry-status',
  '[data-app-manager-status]',
  '.registry-status',
]);
export const likeGirlServiceUrlInput = document.querySelector('#like-girl-service-url');
export const likeGirlCloneServiceUrlInput = document.querySelector('#like-girl-clone-service-url');
export const likeGirlOpenPublicButton = document.querySelector('#like-girl-open-public');
export const likeGirlOpenAdminButton = document.querySelector('#like-girl-open-admin');
export const likeGirlCloneOpenPublicButton = document.querySelector('#like-girl-clone-open-public');
export const likeGirlCloneOpenAdminButton = document.querySelector('#like-girl-clone-open-admin');
export const appRegistryRefreshButton = document.querySelector('#app-registry-refresh');
export const appRegistryStatus = document.querySelector('#app-registry-status');
export const serviceManagerRefreshButton = document.querySelector('#service-manager-refresh');
export const serviceManagerStatus = document.querySelector('#service-manager-status');
export const serviceManagerList = document.querySelector('#service-manager-list');
export const importsForm = document.querySelector('#imports-form');
export const importTypeSelect = document.querySelector('#import-type');
export const importModeSelect = document.querySelector('#import-mode');
export const importFileInput = document.querySelector('#import-file');
export const importJsonInput = document.querySelector('#import-json');
export const importResult = document.querySelector('#import-result');
export const personaForm = document.querySelector('#persona-form');
export const personaNameInput = document.querySelector('#persona-name');
export const personaSignatureInput = document.querySelector('#persona-signature');
export const personaBioInput = document.querySelector('#persona-bio');
export const myProfileForm = document.querySelector('#my-profile-form');
export const myAvatarPreview = document.querySelector('#my-avatar-preview');
export const myAvatarTextInput = document.querySelector('#my-avatar-text');
export const myAvatarFileInput = document.querySelector('#my-avatar-file');
export const myAvatarUploadButton = document.querySelector('#my-avatar-upload');
export const myAvatarRemoveButton = document.querySelector('#my-avatar-remove');
export const myNameInput = document.querySelector('#my-name');
export const mySignatureInput = document.querySelector('#my-signature');
export const myBioInput = document.querySelector('#my-bio');
export const myPreviewName = document.querySelector('#my-preview-name');
export const myPreviewSignature = document.querySelector('#my-preview-signature');
export const characterForm = document.querySelector('#character-form');
export const characterSection = selectAny(['#character-section', '[data-panel="character"]', '[data-character-section]']);
export const characterSectionTabs = selectAllAny(['[data-character-tab]', '[data-character-section-tab]', '.character-tabs [role="tab"]']);
export const characterSectionControls = selectAllAny(['[data-character-control]', '[data-character-action]', '.character-controls button']);
export const characterSelect = document.querySelector('#character-select');
export const characterNameInput = document.querySelector('#character-name');
export const characterAvatarPreview = document.querySelector('#character-avatar-preview');
export const characterAvatarTextInput = document.querySelector('#character-avatar-text');
export const characterAvatarFileInput = document.querySelector('#character-avatar-file');
export const characterAvatarUploadButton = document.querySelector('#character-avatar-upload');
export const characterAvatarRemoveButton = document.querySelector('#character-avatar-remove');
export const characterDescriptionInput = document.querySelector('#character-description');
export const characterRoleLevelSelect = document.querySelector('#character-role-level');
export const characterAgentTypeSelect = document.querySelector('#character-agent-type');
export const characterAgentModeSelect = document.querySelector('#character-agent-mode');
export const characterRuntimeStatus = document.querySelector('#character-runtime-status');
export const characterRuntimeReplyFooterToggle = document.querySelector('#character-runtime-reply-footer');
export const characterRuntimeContextIndicatorToggle = document.querySelector('#character-runtime-context-indicator');
export const characterRuntimeWorkDirInput = document.querySelector('#character-runtime-work-dir');
export const characterRuntimeDisabledCommandsInput = document.querySelector('#character-runtime-disabled-commands');
export const characterRuntimeAdminFromInput = document.querySelector('#character-runtime-admin-from');
export const characterWaifuTextModeToggle = document.querySelector('#character-waifu-text-mode');
export const characterWaifuRemovePunctuationToggle = document.querySelector('#character-waifu-remove-punctuation');
export const characterWaifuDelayInput = document.querySelector('#character-waifu-delay');
export const characterWaifuDelayValue = document.querySelector('#character-waifu-delay-value');
export const characterTimeInjectionToggle = document.querySelector('#character-time-injection-enabled');
export const characterTimezoneInput = document.querySelector('#character-timezone');
export const characterSubtitleInput = document.querySelector('#character-subtitle');
export const characterSummaryInput = document.querySelector('#character-summary');
export const characterCardTextInput = document.querySelector('#character-card-text');
export const characterProactiveToggle = document.querySelector('#character-proactive-toggle');
export const characterSubmitButton = document.querySelector('#character-submit-button');

export const profileName = document.querySelector('#profile-name');
export const profileSignature = document.querySelector('#profile-signature');
export const personaCount = document.querySelector('#persona-count');
export const memoryCount = document.querySelector('#memory-count');
export const journalCount = document.querySelector('#journal-count');
export const personaPreviewName = document.querySelector('#persona-preview-name');
export const personaPreviewBio = document.querySelector('#persona-preview-bio');
export const characterPreviewName = document.querySelector('#character-preview-name');
export const characterPreviewDescription = document.querySelector('#character-preview-description');
