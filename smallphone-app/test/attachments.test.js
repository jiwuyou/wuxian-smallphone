const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");

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
