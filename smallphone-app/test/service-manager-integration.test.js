const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function tryParseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    return new URL(raw, "http://example.invalid");
  } catch {
    return null;
  }
}

function assertTokenQueryRedactedOrDropped(rawUrl, tokenValue, label) {
  const value = typeof rawUrl === "string" ? rawUrl : "";
  if (!value) return;
  assert.equal(value.includes(tokenValue), false, `${label} leaked token value.`);

  const parsed = tryParseUrl(value);
  if (!parsed) {
    assert.equal(value.includes("token="), false, `${label} contains an unparseable token-bearing URL.`);
    assert.equal(value.includes("access_token="), false, `${label} contains an unparseable access_token-bearing URL.`);
    assert.equal(value.includes("authorization="), false, `${label} contains an unparseable authorization-bearing URL.`);
    return;
  }

  for (const key of ["token", "access_token", "authorization"]) {
    const found = parsed.searchParams.get(key);
    if (found === null) continue;
    assert.ok(
      found === "" || found === "[redacted]",
      `${label} contains sensitive query param ${key}=${found}`,
    );
  }
}

function tmpDataFile() {
  return path.join(os.tmpdir(), `smallphone-service-manager-integration-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function installFetchStub(t, handler) {
  const requests = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const headers = init?.headers && typeof init.headers === "object" ? init.headers : {};
    const record = {
      url: String(url),
      method: String(init?.method || "GET").toUpperCase(),
      headers,
      body: init?.body ?? undefined,
      signal: init?.signal,
    };
    requests.push(record);

    const result = await handler(record, requests);
    const status = Number.isFinite(Number(result?.status)) ? Number(result.status) : 200;
    const payload = result?.body ?? { ok: true, data: {} };
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);

    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return text;
      },
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    requests.length = 0;
  });

  return requests;
}

function buildServiceManagerFixture(options = {}) {
  const serviceToken = String(options.serviceToken || "service-token").trim();
  const secretEnvValue = String(options.secretEnvValue || "secret-env").trim();
  const secretCommand = String(options.secretCommand || "secret-command").trim();

  const services = [
    {
      id: "svc-example",
      spec: {
        name: "Example (spec)",
        tags: [
          "smallphone",
          "smallphone-app:svc-example",
          "smallphone-instance:instance-svc-example",
        ],
      },
      status: {
        state: "running",
        message: "ok",
        pid: 4242,
        observedAt: new Date().toISOString(),
      },
      token: serviceToken,
      command: secretCommand,
      env: {
        TOP_SECRET: secretEnvValue,
        SERVICE_MANAGER_TOKEN: serviceToken,
      },
      runtime: {
        kind: "node",
        token: serviceToken,
      },
    },
  ];

  const apps = [
    {
      id: "svc-example",
      name: "Example",
      title: "Example Service",
      entry: "/",
      source: "service-manager",
      kind: "service",
      version: "0.0.1",
      icon: "https://example.invalid/icon.png",
      token: serviceToken,
      command: secretCommand,
      env: { TOP_SECRET: secretEnvValue },
      runtime: { token: serviceToken },
    },
  ];

  const appInstances = [
    {
      id: "instance-svc-example",
      appId: "svc-example",
      title: "Example Instance",
      source: "service-manager",
      entry: "/",
      settings: {
        url: "http://127.0.0.1:9999/",
        token: serviceToken,
        env: { TOP_SECRET: secretEnvValue },
        runtime: { token: serviceToken },
      },
      token: serviceToken,
      env: { TOP_SECRET: secretEnvValue },
      command: secretCommand,
      runtime: { token: serviceToken },
    },
  ];

  // Include both "raw" and "ok/data" wrappers to be compatible with multiple client styles.
  return {
    ok: true,
    data: {
      generatedAt: new Date().toISOString(),
      services,
      apps,
      appInstances,
    },
    generatedAt: new Date().toISOString(),
    services,
    apps,
    appInstances,
  };
}

test("service-manager: Core uses server-side Bearer token and redacts secrets from public registry metadata", async (t) => {
  const serviceManagerToken = randomId("sm-token");
  const secretEnvValue = randomId("sm-secret-env");
  const secretCommand = `run:${randomId("sm-cmd")}`;
  const baseUrlToken = randomId("sm-base-url-token");
  const entryToken = randomId("sm-entry-url-token");
  const instanceUrlToken = randomId("sm-instance-url-token");

  const fixture = buildServiceManagerFixture({
    serviceToken: serviceManagerToken,
    secretEnvValue,
    secretCommand,
  });

  const requests = installFetchStub(t, (request) => {
    if (!request.url.includes("/api/v1/services")) {
      return { status: 404, body: { ok: false, error: "not found" } };
    }
    return { status: 200, body: fixture };
  });

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-sm-core-"));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const serviceManagerBaseUrl = `http://service-manager.local/api/v1?token=${baseUrlToken}&via=smallphone`;
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    smallphoneHome: homeDir,
    runtime: { mode: "mock" },
    serviceManager: {
      baseUrl: serviceManagerBaseUrl,
      token: serviceManagerToken,
      timeoutMs: 50,
    },
  });

  service.updateUserContent({
    apps: [
      {
        id: "svc-example",
        name: "Example",
        title: "Example",
        source: "user",
        entry: `http://127.0.0.1:9999/example/?token=${entryToken}`,
      },
    ],
    appInstances: [
      {
        id: "instance-svc-example",
        appId: "svc-example",
        title: "Example Instance",
        settings: {
          url: `http://127.0.0.1:9999/example/?access_token=${instanceUrlToken}`,
          command: secretCommand,
          env: { TOP_SECRET: secretEnvValue },
          runtime: { token: serviceManagerToken },
        },
        state: {
          command: secretCommand,
          env: { TOP_SECRET: secretEnvValue },
          runtime: { token: serviceManagerToken },
        },
      },
    ],
  });

  const registry = await service.getAppRegistry({ includeServiceManager: true });

  assert.ok(requests.length >= 1, "Expected Core to call service-manager /api/v1/services when configured.");

  const authHeader = String(requests[0]?.headers?.authorization || requests[0]?.headers?.Authorization || "").trim();
  assert.match(authHeader, new RegExp(`^Bearer\\s+${escapeRegExp(serviceManagerToken)}$`, "i"));
  assert.match(
    requests[0].url,
    /^http:\/\/service-manager\.local\/api\/v1\/services\b/,
    "Expected service-manager calls to use /api/v1/services and preserve /api/v1 base path.",
  );

  const publicBody = JSON.stringify(registry);
  assert.equal(publicBody.includes(serviceManagerToken), false, "Public response leaked service-manager token.");
  assert.equal(publicBody.includes(secretEnvValue), false, "Public response leaked service-manager env secrets.");
  assert.equal(publicBody.includes(secretCommand), false, "Public response leaked service-manager command.");
  assert.equal(publicBody.includes(baseUrlToken), false, "Public response leaked token inside service-manager baseUrl query.");
  assert.equal(publicBody.includes(serviceManagerBaseUrl), false, "Public response leaked full service-manager baseUrl.");

  assert.ok(registry.serviceManager && typeof registry.serviceManager === "object");
  assert.equal(hasOwn(registry.serviceManager, "baseUrl"), false, "Public serviceManager metadata must not include baseUrl.");

  const enriched = registry.appInstances.find((item) => item.id === "instance-svc-example");
  assert.ok(enriched);
  assert.ok(enriched.service, "Expected app instance to be enriched with a matching service record.");
  assert.equal(typeof enriched.service.id, "string");
  assert.equal(enriched.service.name, "Example (spec)");
  assert.ok(!("token" in enriched.service));
  assert.ok(!("command" in enriched.service));
  assert.ok(!("env" in enriched.service));
  assert.ok(!("runtime" in enriched.service));

  assert.ok(enriched.settings && typeof enriched.settings === "object");
  assert.equal(hasOwn(enriched.settings, "env"), false, "Public app registry must drop env from appInstances.settings.");
  assert.equal(hasOwn(enriched.settings, "runtime"), false, "Public app registry must drop runtime from appInstances.settings.");
  assert.equal(hasOwn(enriched.settings, "command"), false, "Public app registry must drop command from appInstances.settings.");
  if (enriched.state && typeof enriched.state === "object") {
    assert.equal(hasOwn(enriched.state, "env"), false, "Public app registry must drop env from appInstances.state.");
    assert.equal(hasOwn(enriched.state, "runtime"), false, "Public app registry must drop runtime from appInstances.state.");
    assert.equal(hasOwn(enriched.state, "command"), false, "Public app registry must drop command from appInstances.state.");
  }

  const app = registry.apps.find((item) => item.id === "svc-example");
  assert.ok(app);
  assertTokenQueryRedactedOrDropped(app.entry, entryToken, "registry.apps[].entry");
  assertTokenQueryRedactedOrDropped(enriched?.settings?.url, instanceUrlToken, "registry.appInstances[].settings.url");
});

test("service-manager: app registry degrades gracefully when service-manager is unavailable", async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-sm-core-down-"));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const token = randomId("sm-token");

  installFetchStub(t, () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:20087");
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    smallphoneHome: homeDir,
    runtime: { mode: "mock" },
    serviceManager: {
      baseUrl: "http://127.0.0.1:20087",
      token,
      timeoutMs: 50,
    },
  });

  const registry = await service.getAppRegistry({ includeServiceManager: true });
  assert.ok(registry && typeof registry === "object");
  assert.ok(Array.isArray(registry.apps), "Expected fallback registry to include apps array.");
  assert.ok(Array.isArray(registry.appInstances), "Expected fallback registry to include appInstances array.");

  assert.equal(Boolean(registry.serviceManager?.available), false);
  assert.equal(Boolean(registry.serviceManager?.configured), true);
  assert.equal(hasOwn(registry.serviceManager || {}, "baseUrl"), false, "Fallback registry must not expose service-manager baseUrl.");

  const flattened = JSON.stringify(registry);
  assert.equal(flattened.includes(token), false, "Fallback registry leaked service-manager token.");
});

test("service-manager: logs/actions redact secrets and never expose raw token-bearing payloads", async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-sm-core-actions-"));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const serviceManagerToken = randomId("sm-token");
  const baseUrlToken = randomId("sm-base-url-token");
  const logToken = randomId("sm-log-token");
  const secretCommand = `cmd:${randomId("sm-cmd")}`;
  const secretEnv = randomId("sm-env-secret");

  const fixture = buildServiceManagerFixture({
    serviceToken: serviceManagerToken,
    secretEnvValue: secretEnv,
    secretCommand,
  });

  const requests = installFetchStub(t, (request) => {
    if (request.url.includes("/api/v1/services/") && request.url.includes("/logs")) {
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            lines: [
              "hello",
              `Bearer ${serviceManagerToken}`,
              `http://127.0.0.1:9999/?token=${logToken}`,
              secretCommand,
              secretEnv,
            ],
          },
        },
      };
    }
    if (request.url.includes("/api/v1/services/") && request.url.includes("/start")) {
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            id: "svc-example",
            spec: { name: "Example (spec)", tags: ["smallphone-app:svc-example"] },
            token: serviceManagerToken,
            command: secretCommand,
            env: { TOP_SECRET: secretEnv },
            runtime: { token: serviceManagerToken },
          },
        },
      };
    }
    if (request.url.includes("/api/v1/services")) {
      return { status: 200, body: fixture };
    }
    return { status: 404, body: { ok: false, error: "not found" } };
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    smallphoneHome: homeDir,
    runtime: { mode: "mock" },
    serviceManager: {
      baseUrl: `http://service-manager.local/api/v1?token=${baseUrlToken}`,
      token: serviceManagerToken,
      timeoutMs: 50,
    },
  });

  const logs = await service.getServiceManagerServiceLogs("svc-example", { limit: 10 });
  const logsSerialized = JSON.stringify(logs);
  assert.equal(logsSerialized.includes(serviceManagerToken), false, "Logs response leaked service-manager token.");
  assert.equal(logsSerialized.includes(baseUrlToken), false, "Logs response leaked token inside service-manager baseUrl.");
  assert.equal(logsSerialized.includes(logToken), false, "Logs response leaked token-bearing URL.");
  assert.equal(logsSerialized.includes(secretCommand), false, "Logs response leaked command.");
  assert.equal(logsSerialized.includes(secretEnv), false, "Logs response leaked env secret.");
  assert.equal(hasOwn(logs.serviceManager || {}, "baseUrl"), false, "Logs response must not expose service-manager baseUrl.");

  const action = await service.runServiceManagerServiceAction("svc-example", "start");
  const actionSerialized = JSON.stringify(action);
  assert.equal(actionSerialized.includes(serviceManagerToken), false, "Action response leaked service-manager token.");
  assert.equal(actionSerialized.includes(secretCommand), false, "Action response leaked command.");
  assert.equal(actionSerialized.includes(secretEnv), false, "Action response leaked env secret.");
  assert.equal(hasOwn(action.serviceManager || {}, "baseUrl"), false, "Action response must not expose service-manager baseUrl.");
  assert.ok(action.service, "Expected action response to include a sanitized service record.");
  assert.ok(!("token" in action.service));
  assert.ok(!("command" in action.service));
  assert.ok(!("env" in action.service));
  assert.ok(!("runtime" in action.service));

  const logReq = requests.find((item) => item.url.includes("/logs"));
  assert.ok(logReq);
  assert.ok(
    logReq.url.includes("/api/v1/services/"),
    `Expected logs request URL to include /api/v1/services/: ${logReq.url}`,
  );
  assert.match(
    String(logReq.headers?.authorization || logReq.headers?.Authorization || ""),
    new RegExp(`^Bearer\\s+${escapeRegExp(serviceManagerToken)}$`, "i"),
  );
  const startReq = requests.find((item) => item.url.includes("/start"));
  assert.ok(startReq);
  assert.ok(
    startReq.url.includes("/api/v1/services/"),
    `Expected action request URL to include /api/v1/services/: ${startReq.url}`,
  );
  assert.match(
    String(startReq.headers?.authorization || startReq.headers?.Authorization || ""),
    new RegExp(`^Bearer\\s+${escapeRegExp(serviceManagerToken)}$`, "i"),
  );
});

test("bootstrap: runtime does not expose command or entry", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-bootstrap-runtime-"));
  try {
    const secretCommand = `/very/secret/${randomId("openclaw-command")}`;
    const entryFile = path.join(homeDir, `${randomId("openclaw-entry")}.mjs`);
    fs.writeFileSync(entryFile, "export const ok = true;\n", "utf8");

    const service = new SmallPhoneService({
      dataFile: tmpDataFile(),
      smallphoneHome: homeDir,
      runtime: {
        mode: "openclaw-cli",
        command: secretCommand,
        entry: entryFile,
      },
    });

    const payload = service.bootstrap();
    assert.ok(payload && typeof payload === "object");
    assert.ok(payload.runtime && typeof payload.runtime === "object");

    const runtime = payload.runtime;
    assert.equal(hasOwn(runtime, "command"), false, "Public runtime metadata must not include command.");
    assert.equal(hasOwn(runtime, "entry"), false, "Public runtime metadata must not include entry.");

    const runtimeSerialized = JSON.stringify(runtime);
    assert.equal(runtimeSerialized.includes(secretCommand), false, "Bootstrap leaked runtime command.");
    assert.equal(runtimeSerialized.includes(entryFile), false, "Bootstrap leaked runtime entry path.");
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
