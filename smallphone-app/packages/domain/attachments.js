const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",

  // Text
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",

  // Docs
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function sanitizePathSegment(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function sanitizeFileName(input) {
  const base = path.basename(String(input || "").trim());
  const safe = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe.slice(0, 140) || "attachment";
}

function sanitizeMimeType(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.split(";")[0].trim();
}

function inferKind(mimeType) {
  const mt = sanitizeMimeType(mimeType);
  if (mt.startsWith("image/")) return "image";
  return "file";
}

function normalizeAttachmentIds(input) {
  if (Array.isArray(input)) {
    return dedupeStrings(input.map((item) => String(item || "").trim()).filter(Boolean));
  }
  const single = String(input || "").trim();
  return single ? [single] : [];
}

function dedupeStrings(values) {
  const next = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    next.push(text);
  }
  return next;
}

function parseBase64Upload(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("Attachment content is required.");
  }
  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
    if (!match) {
      throw new Error("Invalid data URL.");
    }
    const hasBase64 = Boolean(match[2]);
    if (!hasBase64) {
      throw new Error("Only base64 data URLs are supported.");
    }
    return {
      mimeType: sanitizeMimeType(match[1] || ""),
      base64: normalizeBase64(match[3] || ""),
    };
  }
  return {
    mimeType: "",
    base64: normalizeBase64(raw),
  };
}

function normalizeBase64(input) {
  const compact = String(input || "").replace(/\s+/g, "");
  if (!compact) return "";

  // base64url -> base64
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length % 4 === 1) {
    throw new Error("Invalid base64 content.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Invalid base64 content.");
  }
  return normalized;
}

function assertAllowedMimeType(mimeType) {
  const mt = sanitizeMimeType(mimeType);
  if (!mt) {
    throw new Error("Attachment mimeType is required.");
  }
  if (!ALLOWED_MIME_TYPES.has(mt)) {
    throw new Error(`Attachment mimeType not allowed: ${mt}`);
  }
}

function assertMaxBytes(size, maxBytes) {
  const limit = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : DEFAULT_MAX_BYTES;
  if (!Number.isFinite(Number(size)) || size < 0) {
    throw new Error("Attachment size is invalid.");
  }
  if (size > limit) {
    throw new Error(`Attachment too large: ${size} bytes (max ${limit}).`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  assertAllowedMimeType,
  assertMaxBytes,
  dedupeStrings,
  ensureDir,
  inferKind,
  normalizeAttachmentIds,
  parseBase64Upload,
  sanitizeFileName,
  sanitizeMimeType,
  sanitizePathSegment,
};

