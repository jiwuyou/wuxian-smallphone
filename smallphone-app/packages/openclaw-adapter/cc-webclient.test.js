const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRuntimeAdapter } = require("./index");

function makeHeaders(init = {}) {
  const entries = Object.entries(init || {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]);
  return {
    get(name) {
      const needle = String(name || "").toLowerCase();
      const found = entries.find(([k]) => k === needle);
      return found ? found[1] : null;
    },
    forEach(fn) {
      for (const [k, v] of entries) fn(v, k);
    },
  };
}

function makeResponse({ ok, status, json, text, headers, bodyBytes }) {
  const bodyText = typeof text === "string" ? text : json !== undefined ? JSON.stringify(json) : "";
  const bytes = bodyBytes instanceof Uint8Array ? bodyBytes : bodyBytes ? Uint8Array.from(bodyBytes) : new Uint8Array();
  return {
    ok,
    status,
    headers: makeHeaders(headers),
    async json() {
      if (json !== undefined) return json;
      return JSON.parse(bodyText || "null");
    },
    async text() {
      return bodyText;
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

test("createRuntimeAdapter recognizes cc-webclient modes", () => {
  assert.equal(createRuntimeAdapter({ mode: "cc-webclient" }).describe().id, "cc-webclient");
  assert.equal(createRuntimeAdapter({ mode: "cc_webclient" }).describe().id, "cc-webclient");
  assert.equal(createRuntimeAdapter({ mode: "ccwebclient" }).describe().id, "cc-webclient");
});

test("cc-webclient adapter sends images and polls for assistant reply + attachments", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-webclient-"));
  const imgPath = path.join(tmpDir, "a.png");
  const filePath = path.join(tmpDir, "doc.txt");
  fs.writeFileSync(imgPath, Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(filePath, "hello");

  const calls = [];
  let pollCount = 0;

  const fetchStub = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const u = new URL(String(url));
    calls.push({ method, pathname: u.pathname, search: u.search, body: options.body || "" });

    if (method === "POST" && u.pathname.endsWith("/send")) {
      const body = JSON.parse(String(options.body || "{}"));
      assert.equal(body.session_key, "webclient:proj:thread-abc");
      assert.equal(body.session_id, "s1");
      assert.ok(typeof body.message === "string" && body.message.length > 0);
      assert.match(body.message, /Attached files/i);
      assert.match(body.message, /doc\.txt/);
      assert.equal(Array.isArray(body.images), true);
      assert.equal(body.images.length, 1);
      assert.equal(body.images[0].mime_type, "image/png");
      assert.equal(body.images[0].file_name, "a.png");
      assert.deepEqual(Buffer.from(body.images[0].data, "base64"), Buffer.from([1, 2, 3, 4]));
      return makeResponse({
        ok: true,
        status: 200,
        json: {
          ok: true,
          data: {
            message: "message queued",
            session_key: body.session_key,
            session_id: body.session_id,
            outbox_id: "out-1",
          },
        },
      });
    }

    if (method === "POST" && u.pathname.endsWith("/sessions")) {
      const body = JSON.parse(String(options.body || "{}"));
      assert.equal(body.session_key, "webclient:proj:thread-abc");
      assert.equal(body.name, "thread-abc");
      return makeResponse({
        ok: true,
        status: 200,
        json: {
          ok: true,
          data: {
            id: "s1",
            session_key: body.session_key,
            name: body.name,
          },
        },
      });
    }

    if (method === "GET" && u.pathname.includes("/sessions/s1")) {
      pollCount += 1;
      if (pollCount === 1) {
        return makeResponse({
          ok: true,
          status: 200,
          json: {
            ok: true,
            data: {
              id: "s1",
              session_key: "webclient:proj:thread-abc",
              history: [
                {
                  id: "u1",
                  seq: 1,
                  role: "user",
                  user_message_id: "out-1",
                  content: "user content",
                },
              ],
              run_events: [],
            },
          },
        });
      }
      return makeResponse({
        ok: true,
        status: 200,
        json: {
          ok: true,
          data: {
          id: "s1",
            session_key: "webclient:proj:thread-abc",
            history: [
              {
                id: "u1",
                seq: 1,
                role: "user",
                user_message_id: "out-1",
                content: "user content",
              },
              {
                id: "a1",
                seq: 2,
                role: "assistant",
                user_message_id: "out-1",
                content: "hi",
                images: [
                  {
                    id: "img1",
                    mime_type: "image/png",
                    url: "/apps/smallphone/attachments/img1",
                    file_name: "reply.png",
                    size: 10,
                  },
                ],
                files: [
                  {
                    id: "f1",
                    kind: "file",
                    mime_type: "text/plain",
                    url: "/apps/smallphone/attachments/f1",
                    file_name: "reply.txt",
                    size: 5,
                  },
                ],
              },
            ],
            run_events: [],
          },
        },
      });
    }

    return makeResponse({ ok: false, status: 500, text: `unexpected fetch ${method} ${u.pathname}` });
  };

  const runtime = createRuntimeAdapter({
    mode: "cc-webclient",
    webclientBaseUrl: "http://127.0.0.1:9840",
    webclientToken: "test-token",
    webclientAppId: "smallphone",
    ccConnectProject: "proj",
    timeoutMs: 2000,
    pollIntervalMs: 1,
    fetch: fetchStub,
  });

  const result = await runtime.sendTurn({
    runtimeSessionId: "smallphone-legacy-bridge-replyctx",
    thread: {
      id: "thread-abc",
      title: "Thread",
      runtime: { sessionKey: "smallphone:thread:thread-abc", sessionGeneration: 1 },
    },
    contact: { id: "c1", displayName: "Alice" },
    character: { name: "Bob", persona: "persona" },
    relationship: { trust: 0.5, intimacy: 0.1, tension: 0.2 },
    memories: [],
    messages: [{ role: "user", content: "hello" }],
    turnContext: null,
    attachments: [
      { id: "att-img", kind: "image", localPath: imgPath, mimeType: "image/png", fileName: "a.png", size: 4 },
      { id: "att-file", kind: "file", localPath: filePath, mimeType: "text/plain", fileName: "doc.txt", size: 5 },
    ],
  });

  assert.equal(result.runtimeSessionId, "s1");
  assert.equal(result.runtimeSessionKey, "webclient:proj:thread-abc");
  assert.equal(result.assistantText, "hi");
  assert.equal(Array.isArray(result.assistantAttachments), true);
  assert.equal(result.assistantAttachments.length, 2);
  assert.deepEqual(
    result.assistantAttachments.map((a) => a.kind).sort(),
    ["file", "image"],
  );

  // Sanity: we did a send and at least one poll.
  assert.ok(calls.some((c) => c.method === "POST" && c.pathname.endsWith("/send")));
  assert.ok(calls.some((c) => c.method === "GET" && c.pathname.includes("/sessions/s1")));
});

test("cc-webclient adapter fetchAttachment proxies allowed URLs and rejects cross-origin", async () => {
  const calls = [];
  const fetchStub = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const u = new URL(String(url));
    const auth = options?.headers?.authorization || options?.headers?.Authorization || "";
    calls.push({ method, origin: u.origin, pathname: u.pathname, search: u.search, auth });

    if (method === "GET" && u.pathname === "/apps/smallphone/attachments/img1") {
      assert.equal(String(auth), "Bearer test-token");
      assert.equal(u.search, "");
      return makeResponse({
        ok: true,
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-disposition": "attachment; filename=\"reply.png\"",
        },
        bodyBytes: Uint8Array.from([9, 8, 7]),
      });
    }

    return makeResponse({ ok: false, status: 404, text: "not found" });
  };

  const runtime = createRuntimeAdapter({
    mode: "cc-webclient",
    webclientBaseUrl: "http://127.0.0.1:9840",
    webclientToken: "test-token",
    webclientAppId: "smallphone",
    ccConnectProject: "proj",
    timeoutMs: 2000,
    fetch: fetchStub,
  });

  const fetched = await runtime.fetchAttachment({
    url: "/apps/smallphone/attachments/img1?token=leak",
    attachment: { fileName: "fallback.bin", mimeType: "application/octet-stream" },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.mimeType, "image/png");
  assert.equal(fetched.fileName, "reply.png");
  assert.deepEqual(Buffer.from(fetched.body), Buffer.from([9, 8, 7]));

  await assert.rejects(
    () =>
      runtime.fetchAttachment({
        url: "http://evil.test/api/v1/settings",
        attachment: { fileName: "x", mimeType: "x" },
      }),
    /refused non-attachment path/i,
  );

  assert.ok(calls.some((c) => c.pathname === "/apps/smallphone/attachments/img1"));
});

test("cc-webclient adapter fetchAttachment rewrites public_url origin to internal baseUrl", async () => {
  const calls = [];
  const fetchStub = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const u = new URL(String(url));
    calls.push({ method, origin: u.origin, pathname: u.pathname, search: u.search });
    return makeResponse({
      ok: true,
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      bodyBytes: Uint8Array.from([1]),
    });
  };

  const runtime = createRuntimeAdapter({
    mode: "cc-webclient",
    webclientBaseUrl: "http://127.0.0.1:9840",
    webclientToken: "test-token",
    webclientAppId: "smallphone",
    ccConnectProject: "proj",
    timeoutMs: 2000,
    fetch: fetchStub,
  });

  await runtime.fetchAttachment({
    url: "https://public.example.com/apps/smallphone/attachments/img1?token=leak",
    attachment: { fileName: "", mimeType: "" },
  });

  const call = calls.at(-1);
  assert.equal(call.origin, "http://127.0.0.1:9840");
  assert.equal(call.pathname, "/apps/smallphone/attachments/img1");
  assert.equal(call.search, "");
});
