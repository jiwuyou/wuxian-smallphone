const { nowIso } = require("./types");

const PROMPT_BOARD_VERSION = 1;
const DEFAULT_JOINER = "\n\n";
const DEFAULT_MODULE_KIND = "template";
const DEFAULT_WORKFLOW_MODE = "parallel";
const DEFAULT_WORKFLOW_NODE_TYPE = "context.block";
const DEFAULT_WORKFLOW_OUTPUTS = [DEFAULT_WORKFLOW_NODE_TYPE];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function coerceString(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

function normalizeLineEndings(value) {
  return coerceString(value).replaceAll("\r\n", "\n");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(context, path) {
  const raw = String(path || "").trim();
  if (!raw) return undefined;
  const parts = raw.split(".").map((part) => part.trim()).filter(Boolean);
  let cursor = context;
  for (const part of parts) {
    if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function isTruthy(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function stringifyTemplateValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function renderTemplate(template, context) {
  const rawTemplate = coerceString(template);
  if (!rawTemplate) return "";
  const ctx = isPlainObject(context) ? context : {};

  // Minimal conditional support: {{#if some.path}}...{{/if}}
  const withIfs = rawTemplate.replace(/{{#if\s+([^}]+)}}([\s\S]*?){{\/if}}/g, (_match, path, body) => {
    const value = readPath(ctx, path);
    return isTruthy(value) ? String(body ?? "") : "";
  });

  // Variable replacement: {{some.path}}
  return withIfs.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path) => {
    const value = readPath(ctx, path);
    return stringifyTemplateValue(value);
  });
}

function normalizePromptBoardModuleKind(value) {
  const raw = normalizeText(value);
  return raw || DEFAULT_MODULE_KIND;
}

function normalizePromptBoardModuleWorkflow(input) {
  const raw = isPlainObject(input) ? input : {};
  const mode = normalizeText(raw.mode) || DEFAULT_WORKFLOW_MODE;
  const nodeType = normalizeText(raw.nodeType || raw.node_type) || DEFAULT_WORKFLOW_NODE_TYPE;
  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map((v) => normalizeText(v)).filter(Boolean) : [];
  const outputsRaw = Array.isArray(raw.outputs) ? raw.outputs.map((v) => normalizeText(v)).filter(Boolean) : [];
  const outputs = outputsRaw.length ? outputsRaw : DEFAULT_WORKFLOW_OUTPUTS.slice();
  return {
    mode,
    nodeType,
    inputs,
    outputs,
  };
}

function normalizePromptBoardModuleFieldType(value) {
  const raw = normalizeText(value).toLowerCase();
  return raw === "text" ? "text" : "textarea";
}

function normalizePromptBoardModuleField(input, options = {}) {
  const raw = isPlainObject(input) ? input : {};
  const id = normalizeText(raw.id);
  if (!id) return null;
  const label = normalizeText(raw.label) || id;
  const type = normalizePromptBoardModuleFieldType(raw.type);
  const placeholder = normalizeText(raw.placeholder);
  const sourceType = normalizeText(raw.sourceType || raw.source_type) || "manual";
  const source = normalizeText(raw.source);
  const attribute = normalizeText(raw.attribute);
  const path = normalizeText(raw.path);
  const fallback = normalizeLineEndings(raw.value || raw.fallback || "");

  const field = {
    id,
    label,
    type,
    value: fallback,
    placeholder,
    sourceType,
    source,
    attribute,
    path,
  };

  if (options.preserveResolvedValue && raw.resolvedValue != null) {
    field.resolvedValue = normalizeLineEndings(raw.resolvedValue);
  }

  return field;
}

function normalizePromptBoardModuleFields(fields, options = {}) {
  const list = Array.isArray(fields) ? fields : [];
  return list.map((field) => normalizePromptBoardModuleField(field, options)).filter(Boolean);
}

function moduleFieldValues(fields, options = {}) {
  const values = {};
  for (const field of normalizePromptBoardModuleFields(fields, options)) {
    if (field.resolvedValue != null) {
      values[field.id] = normalizeLineEndings(field.resolvedValue);
    } else {
      values[field.id] = normalizeLineEndings(field.value || field.fallback || "");
    }
  }
  return values;
}

function buildModuleCompileContext(context, module, options = {}) {
  const base = isPlainObject(context) ? context : {};
  const values = moduleFieldValues(module?.fields, options);
  return {
    ...base,
    fields: values,
    vars: values,
    app: values,
    module: {
      id: normalizeText(module?.id),
      title: coerceString(module?.title),
      description: coerceString(module?.description),
      kind: normalizePromptBoardModuleKind(module?.kind),
      workflow: normalizePromptBoardModuleWorkflow(module?.workflow),
    },
  };
}

function normalizePromptBoardModule(input, fallbackIndex = 0, options = {}) {
  const raw = isPlainObject(input) ? input : {};
  const id = normalizeText(raw.id) || `module-${fallbackIndex + 1}`;
  const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : fallbackIndex + 1;
  const enabled = hasOwn(raw, "enabled") ? Boolean(raw.enabled) : true;
  const template = normalizeLineEndings(raw.template);
  const title = coerceString(raw.title);
  const description = coerceString(raw.description);
  const contentOverride = hasOwn(raw, "contentOverride")
    ? raw.contentOverride == null
      ? null
      : normalizeLineEndings(raw.contentOverride)
    : null;
  return {
    id,
    title,
    description,
    kind: normalizePromptBoardModuleKind(raw.kind),
    enabled,
    template,
    contentOverride,
    order,
    fields: normalizePromptBoardModuleFields(raw.fields, options),
    workflow: normalizePromptBoardModuleWorkflow(raw.workflow),
  };
}

function normalizePromptBoardModules(modules, options = {}) {
  const list = Array.isArray(modules) ? modules : [];
  const normalized = list.map((item, index) => normalizePromptBoardModule(item, index, options));

  // Ensure unique ids (stable, deterministic).
  const seen = new Map();
  for (const module of normalized) {
    const base = module.id;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    if (count > 1) {
      module.id = `${base}.${count}`;
    }
  }

  normalized.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
  return normalized;
}

function compilePromptBoard(input = {}) {
  const joiner = typeof input.joiner === "string" ? input.joiner : DEFAULT_JOINER;
  // During compilation, `resolvedValue` is a compile-time input (never persisted).
  const modules = normalizePromptBoardModules(input.modules, { preserveResolvedValue: true });
  const context = isPlainObject(input.context) ? input.context : {};
  const compiledAt = nowIso();

  const sections = [];
  const finalParts = [];
  let lengthSoFar = 0;

  for (const module of modules) {
    const section = {
      moduleId: module.id,
      title: module.title,
      description: module.description,
      enabled: module.enabled,
      order: module.order,
      template: module.template,
      contentOverride: module.contentOverride,
      source: "template",
      content: "",
      included: false,
      startOffset: null,
      endOffset: null,
    };

    if (!module.enabled) {
      sections.push(section);
      continue;
    }

    const content =
      module.contentOverride !== null
        ? ((section.source = "override"), coerceString(module.contentOverride))
        : renderTemplate(module.template, buildModuleCompileContext(context, module, { preserveResolvedValue: true }));

    section.content = content;
    if (normalizeText(content)) {
      section.included = true;
      if (finalParts.length) {
        lengthSoFar += joiner.length;
      }
      section.startOffset = lengthSoFar;
      lengthSoFar += content.length;
      section.endOffset = lengthSoFar;
      finalParts.push(content);
    }

    sections.push(section);
  }

  const finalText = finalParts.join(joiner);
  const trace = {
    version: PROMPT_BOARD_VERSION,
    compiledAt,
    joiner,
    finalTextBytes: Buffer.byteLength(finalText, "utf8"),
    includedModuleIds: sections.filter((s) => s.included).map((s) => s.moduleId),
    sections: sections
      .filter((s) => s.included)
      .map((s) => ({
        moduleId: s.moduleId,
        source: s.source,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
      })),
  };

  return {
    version: PROMPT_BOARD_VERSION,
    compiledAt,
    sections,
    finalText,
    trace,
  };
}

function createDefaultPromptBoardModulesV1() {
  // These defaults are designed to mirror the existing cc-webclient prompt shape.
  return [
    {
      id: "pb.header",
      title: "Header",
      description: "Static header line for the runtime message.",
      enabled: true,
      order: 10,
      template: "SmallPhone turn",
      contentOverride: null,
    },
    {
      id: "pb.character",
      title: "Character",
      description: "Who the assistant should roleplay as.",
      enabled: true,
      order: 20,
      template: "Character: {{character.name}}",
      contentOverride: null,
    },
    {
      id: "pb.persona",
      title: "Persona",
      description: "The character persona/system prompt.",
      enabled: true,
      order: 30,
      template: "Persona: {{character.persona}}",
      contentOverride: null,
    },
    {
      id: "pb.user_persona",
      title: "User Persona",
      description: "User-side persona/context (UI metadata is not sent).",
      enabled: true,
      order: 40,
      template: "{{#if userPersona}}User persona: {{userPersona}}{{/if}}",
      contentOverride: null,
    },
    {
      id: "pb.contact",
      title: "Contact",
      description: "Display name for the chat partner.",
      enabled: true,
      order: 50,
      template: "Contact: {{contact.displayName}}",
      contentOverride: null,
    },
    {
      id: "pb.thread",
      title: "Thread",
      description: "Thread label (title or id).",
      enabled: true,
      order: 60,
      template: "Thread: {{threadLabel}}",
      contentOverride: null,
    },
    {
      id: "pb.relationship",
      title: "Relationship",
      description: "Relationship state numbers used for tone calibration.",
      enabled: true,
      order: 70,
      template: "{{#if relationshipLine}}{{relationshipLine}}{{/if}}",
      contentOverride: null,
    },
    {
      id: "pb.time",
      title: "Time Context",
      description: "Backend time block (optional).",
      enabled: true,
      order: 80,
      template: "{{timeContextBlock}}",
      contentOverride: null,
    },
    {
      id: "pb.turn_context",
      title: "Turn Context",
      description: "Dynamic context computed from masks/worldbook/relationship.",
      enabled: true,
      order: 90,
      template: "{{turnContextBlock}}",
      contentOverride: null,
    },
    {
      id: "pb.memories",
      title: "Memories",
      description: "Short list of relevant memories (optional).",
      enabled: true,
      order: 100,
      template: "{{#if memoriesBlock}}Relevant memories:\n{{memoriesBlock}}{{/if}}",
      contentOverride: null,
    },
    {
      id: "pb.files",
      title: "Attachments",
      description: "File attachment listing (local paths), if any.",
      enabled: true,
      order: 110,
      template: "{{fileBlock}}",
      contentOverride: null,
    },
    {
      id: "pb.user_message",
      title: "User Message",
      description: "The current user message (or trigger note).",
      enabled: true,
      order: 120,
      template: "{{#if primaryText}}User message:\n{{primaryText}}{{/if}}",
      contentOverride: null,
    },
    {
      id: "pb.instruction",
      title: "Instruction",
      description: "High-level response style instruction.",
      enabled: true,
      order: 130,
      template: "Reply as the contact inside a small-phone chat. Be concise and concrete.",
      contentOverride: null,
    },
  ];
}

module.exports = {
  PROMPT_BOARD_VERSION,
  DEFAULT_JOINER,
  normalizePromptBoardModule,
  normalizePromptBoardModules,
  renderTemplate,
  compilePromptBoard,
  createDefaultPromptBoardModulesV1,
};
