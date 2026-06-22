const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const { resolveSmallPhonePaths } = require("../packages/shared/paths");

function tmpDataFile() {
  return path.join("/tmp", `smallphone-attachments-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

test("attachments: createAttachment stores file and metadata", () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const payload = {
    fileName: "hello.txt",
    mimeType: "text/plain",
    data: Buffer.from("hello", "utf8").toString("base64"),
  };
  const created = service.createAttachment(payload);
  assert.ok(created.id);
  assert.equal(created.fileName, "hello.txt");
  assert.equal(created.mimeType, "text/plain");
  assert.ok(created.downloadUrl.includes(created.id));

  const record = service.getAttachment(created.id);
  assert.ok(record.localPath);
  assert.ok(fs.existsSync(record.localPath));
  assert.equal(fs.readFileSync(record.localPath, "utf8"), "hello");

  // Cleanup: remove the attachment directory.
  const attDir = path.dirname(record.localPath);
  fs.rmSync(attDir, { recursive: true, force: true });
});

test("avatars: createAvatar stores image and companion exposes avatarUrl", async () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const avatar = service.createAvatar({
    fileName: "face.png",
    mimeType: "image/png",
    data: Buffer.from("fake-png", "utf8").toString("base64"),
  });
  assert.ok(avatar.id);
  assert.equal(avatar.kind, "image");
  assert.equal(avatar.purpose, "avatar");

  const updated = await service.updateCompanion("contact-aki", {
    name: "Aki",
    displayName: "Aki",
    avatar: "AK",
    avatarAttachmentId: avatar.id,
  });

  assert.equal(updated.contact.character.avatarAttachmentId, avatar.id);
  assert.equal(updated.contact.character.avatarUrl, `/api/attachments/${avatar.id}`);

  const record = service.getAttachment(avatar.id);
  const attDir = path.dirname(record.localPath);
  fs.rmSync(attDir, { recursive: true, force: true });
});

test("avatars: companion update rejects non-image attachment", async () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const attachment = service.createAttachment({
    fileName: "note.txt",
    mimeType: "text/plain",
    data: Buffer.from("not an avatar", "utf8").toString("base64"),
  });

  await assert.rejects(
    service.updateCompanion("contact-aki", { avatarAttachmentId: attachment.id }),
    /Avatar attachment must be an image/,
  );

  const record = service.getAttachment(attachment.id);
  fs.rmSync(path.dirname(record.localPath), { recursive: true, force: true });
});

test("attachments: sendMessage binds attachment to user message and hydrates metadata", async () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const created = service.createAttachment({
    fileName: "note.md",
    mimeType: "text/markdown",
    data: Buffer.from("# hi", "utf8").toString("base64"),
  });

  const result = await service.sendMessage("thread-aki", {
    text: "see attached",
    attachments: [created.id],
  });

  assert.equal(result.userMessage.attachmentIds.length, 1);
  assert.equal(result.userMessage.attachments.length, 1);
  assert.equal(result.userMessage.attachments[0].id, created.id);

  const updated = service.getAttachment(created.id);
  assert.equal(updated.threadId, "thread-aki");
  assert.equal(updated.messageId, result.userMessage.id);
  assert.equal(updated.role, "user");

  const messages = service.getMessages("thread-aki");
  const hydrated = messages.find((m) => m.id === result.userMessage.id);
  assert.ok(hydrated);
  assert.equal(hydrated.attachments.length, 1);
  assert.equal(hydrated.attachments[0].fileName, "note.md");

  // Cleanup: remove the attachment directory.
  const attDir = path.dirname(updated.localPath);
  fs.rmSync(attDir, { recursive: true, force: true });
});

test("attachments: commitAssistantMessage persists assistantAttachments refs", () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const state = service.store.read();
  const thread = state.threads.find((t) => t.id === "thread-aki");
  assert.ok(thread);
  const contact = state.contacts.find((c) => c.id === thread.contactId);
  assert.ok(contact);

  const msg = service.commitAssistantMessage({
    threadId: thread.id,
    contact,
    userText: "x",
    routedThread: thread,
    runtimeResult: {
      runtimeSessionId: "sess-1",
      assistantText: "ok",
      assistantAttachments: [
        {
          fileName: "out.png",
          mimeType: "image/png",
          size: 123,
          url: "http://example.invalid/out.png",
          source: "webclient",
        },
      ],
    },
  });

  const hydrated = service.getMessages("thread-aki").find((m) => m.id === msg.id);
  assert.ok(hydrated);
  assert.equal(hydrated.attachments.length, 1);
  assert.equal(hydrated.attachments[0].fileName, "out.png");
  assert.equal(hydrated.attachments[0].mimeType, "image/png");

  const attId = hydrated.attachmentIds[0];
  const record = service.getAttachment(attId);
  assert.equal(record.role, "assistant");
  assert.equal(record.messageId, msg.id);
  assert.equal(record.threadId, "thread-aki");
  assert.equal(record.url, "http://example.invalid/out.png");
});

test("attachments: assistant localPath outside managed root is not persisted or served", async () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
  });

  const state = service.store.read();
  const thread = state.threads.find((t) => t.id === "thread-aki");
  assert.ok(thread);
  const contact = state.contacts.find((c) => c.id === thread.contactId);
  assert.ok(contact);

  const msg = service.commitAssistantMessage({
    threadId: thread.id,
    contact,
    userText: "x",
    routedThread: thread,
    runtimeResult: {
      runtimeSessionId: "sess-2",
      assistantText: "ok",
      assistantAttachments: [
        {
          fileName: "passwd.txt",
          mimeType: "text/plain",
          size: 123,
          localPath: "/etc/passwd",
          url: "http://example.invalid/passwd",
          source: "webclient",
        },
      ],
    },
  });

  const hydrated = service.getMessages("thread-aki").find((m) => m.id === msg.id);
  assert.ok(hydrated);
  assert.equal(hydrated.attachments.length, 1);
  const attId = hydrated.attachmentIds[0];

  const record = service.getAttachment(attId);
  assert.equal(record.localPath, "");
  assert.equal(record.url, "http://example.invalid/passwd");

  const download = await service.openAttachmentDownload(attId);
  assert.equal(download.kind, "remote_unproxied");
});

test("attachments: legacy migrated localPath remains readable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-legacy-"));
  const home = path.join(root, "home");
  const legacyDataRoot = path.join(root, "legacy-data");
  const legacyAttachmentsRoot = path.join(legacyDataRoot, "attachments");
  const legacyRuntimeFile = path.join(legacyDataRoot, "runtime.json");
  const localPath = path.join(legacyAttachmentsRoot, "thread-legacy", "att-legacy", "legacy.txt");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, "legacy attachment", "utf8");
  fs.writeFileSync(
    legacyRuntimeFile,
    JSON.stringify(
      {
        attachments: [
          {
            id: "att-legacy",
            kind: "file",
            fileName: "legacy.txt",
            mimeType: "text/plain",
            size: 17,
            source: "legacy",
            localPath,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ),
  );

  const paths = {
    ...resolveSmallPhonePaths({ smallphoneHome: home, env: {} }),
    legacyRuntimeFile,
    legacyAttachmentsRoot,
  };
  const service = new SmallPhoneService({
    paths,
    runtime: { mode: "mock" },
  });

  try {
    const record = service.getAttachment("att-legacy");
    assert.equal(record.localPath, localPath);
    assert.equal(fs.readFileSync(record.localPath, "utf8"), "legacy attachment");

    const download = await service.openAttachmentDownload("att-legacy");
    assert.equal(download.kind, "local");
    assert.equal(download.localPath, localPath);
    assert.equal(download.fileName, "legacy.txt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cc-webclient hydration updates thread preview without replacing profile summary", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    assert.equal(String(options.method || "GET").toUpperCase(), "GET");
    assert.equal(parsed.pathname, "/apps/smallphone/api/v1/projects/proj-preview/sessions/s1");
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          ok: true,
          data: {
            history: [
              {
                id: "u1",
                role: "user",
                content: "hello",
                created_at: "2099-01-01T00:00:01.000Z",
              },
              {
                id: "a1",
                role: "assistant",
                content: "remote assistant reply",
                created_at: "2099-01-01T00:00:02.000Z",
              },
            ],
          },
        });
      },
    };
  };

  try {
    const service = new SmallPhoneService({
      dataFile: tmpDataFile(),
      runtime: {
        mode: "cc-webclient",
        webclientBaseUrl: "http://127.0.0.1:21040",
        webclientToken: "test-token",
        webclientAppId: "smallphone",
      },
    });
    service.store.update((state) => {
      const thread = state.threads.find((item) => item.id === "thread-aki");
      assert.ok(thread);
      thread.summary = "user: old local chat | assistant: stale local reply";
      thread.runtimeSessionId = "s1";
      thread.runtime = {
        ...(thread.runtime || {}),
        project: "proj-preview",
      };
      state.messages.push({
        id: "local-assistant-placeholder",
        threadId: "thread-aki",
        role: "assistant",
        content: "📬 消息已收到，将在当前任务完成后处理。",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      return state;
    });

    const threads = await service.listThreadsHydrated();
    const thread = threads.find((item) => item.id === "thread-aki");
    assert.ok(thread);
    assert.equal(thread.summary, "Claude Code 的独立一对一窗口。");
    assert.equal(thread.lastMessage.content, "remote assistant reply");

    const bootstrap = await service.bootstrapHydrated();
    const contact = bootstrap.contacts.find((item) => item.id === "contact-aki");
    assert.ok(contact);
    assert.equal(contact.thread.lastMessage.content, "remote assistant reply");
  } finally {
    global.fetch = originalFetch;
  }
});
