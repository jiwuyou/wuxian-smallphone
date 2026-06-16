const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const { DEFAULT_SMALLPHONE_HOME, resolveSmallPhonePaths } = require("../packages/shared/paths");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-home-"));
}

function findSensitiveKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      findSensitiveKeys(item, keys);
    }
    return keys;
  }
  if (!value || typeof value !== "object") {
    return keys;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["token", "apikey", "secret", "password", "authorization", "credentials"].includes(normalized)) {
      keys.push(key);
    }
    findSensitiveKeys(item, keys);
  }
  return keys;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`server did not start: ${output}`));
    }, 5000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (settled || !output.includes("[smallphone] listening")) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited before listen code=${code} signal=${signal}: ${output}`));
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test("paths: SMALLPHONE_HOME controls runtime and attachment persistence", () => {
  const home = tmpHome();
  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });

  assert.equal(service.store.filePath, path.join(home, "runtime.json"));
  assert.ok(fs.existsSync(path.join(home, "runtime.json")));

  const created = service.createAttachment({
    fileName: "hello.txt",
    mimeType: "text/plain",
    data: Buffer.from("hello", "utf8").toString("base64"),
  });
  const record = service.getAttachment(created.id);
  assert.ok(record.localPath.startsWith(path.join(home, "attachments")));
  assert.equal(fs.readFileSync(record.localPath, "utf8"), "hello");

  fs.rmSync(home, { recursive: true, force: true });
});

test("paths: runtime store recreates SMALLPHONE_HOME if it is removed while server is running", async () => {
  const home = tmpHome();
  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });

  fs.rmSync(home, { recursive: true, force: true });

  const bootstrap = await service.bootstrapHydrated();

  assert.equal(bootstrap.app.name, "SmallPhone");
  assert.ok(fs.existsSync(path.join(home, "runtime.json")));

  fs.rmSync(home, { recursive: true, force: true });
});

test("paths: default SMALLPHONE_HOME is outside smallphone-active", () => {
  const paths = resolveSmallPhonePaths({ env: {} });
  assert.equal(paths.smallphoneHome, DEFAULT_SMALLPHONE_HOME);
  assert.equal(path.basename(paths.activeRoot), "smallphone-active");
  assert.ok(!paths.smallphoneHome.startsWith(`${paths.activeRoot}${path.sep}`));
});

test("user content: save preserves user records with default ids", () => {
  const home = tmpHome();
  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });

  service.updateUserContent({
    shells: [
      {
        id: "official",
        name: "Customized Official Shell",
        source: "official",
        entry: "index.html",
      },
      {
        id: "custom-shell",
        name: "Custom Shell",
        source: "user",
        entry: "index.html",
      },
    ],
    themes: [
      {
        id: "default",
        name: "Customized Theme",
        source: "user",
        tokens: { accent: "#123456" },
      },
    ],
    appInstances: [
      {
        id: "instance-chat",
        appId: "chat",
        title: "Pinned Chat",
        state: { pinned: true },
      },
    ],
    activeShell: "custom-shell",
  });

  const reloaded = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });
  const content = reloaded.getUserContent();

  assert.equal(content.shells.find((item) => item.id === "official").name, "Customized Official Shell");
  assert.equal(content.themes.find((item) => item.id === "default").name, "Customized Theme");
  assert.equal(content.appInstances.find((item) => item.id === "instance-chat").title, "Pinned Chat");
  assert.equal(content.activeShell, "custom-shell");

  fs.rmSync(home, { recursive: true, force: true });
});

test("app registry: strips sensitive fields from user content records", () => {
  const home = tmpHome();
  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });

  service.updateUserContent({
    apps: [
      {
        id: "secret-app",
        name: "Secret App",
        title: "Secret App",
        source: "user",
        entry: "/apps/secret",
        token: "app-token-value",
        apiKey: "app-api-key-value",
        secret: "app-secret-value",
      },
    ],
    appInstances: [
      {
        id: "secret-instance",
        appId: "secret-app",
        title: "Secret Instance",
        source: "user",
        apiKey: "instance-api-key-value",
        settings: {
          visible: true,
          token: "settings-token-value",
          nested: {
            apiKey: "nested-api-key-value",
            safe: "kept",
          },
        },
        state: {
          secret: "state-secret-value",
          safe: "kept",
        },
      },
    ],
  });

  const registry = service.getAppRegistry();
  const serialized = JSON.stringify(registry);

  assert.equal(findSensitiveKeys(registry).length, 0);
  assert.ok(!serialized.includes("app-token-value"));
  assert.ok(!serialized.includes("app-api-key-value"));
  assert.ok(!serialized.includes("app-secret-value"));
  assert.ok(!serialized.includes("instance-api-key-value"));
  assert.ok(!serialized.includes("settings-token-value"));
  assert.ok(!serialized.includes("nested-api-key-value"));
  assert.ok(!serialized.includes("state-secret-value"));
  assert.equal(
    registry.appInstances.find((item) => item.id === "secret-instance").settings.nested.safe,
    "kept",
  );

  fs.rmSync(home, { recursive: true, force: true });
});

test("shell paths: user shell assets stay inside SMALLPHONE_HOME shell root", () => {
  const home = tmpHome();
  const shellRoot = path.join(home, "shells", "custom-shell");
  fs.mkdirSync(shellRoot, { recursive: true });
  fs.writeFileSync(path.join(shellRoot, "index.html"), "<!doctype html>", "utf8");
  fs.writeFileSync(path.join(home, "secret.txt"), "secret", "utf8");

  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });
  service.updateUserContent({
    shells: [
      {
        id: "custom-shell",
        name: "Custom Shell",
        source: "user",
        entry: "index.html",
      },
    ],
    activeShell: "custom-shell",
  });

  const resolved = service.resolveShellAssetPath({ assetPath: "index.html" });
  assert.equal(resolved.filePath, path.join(shellRoot, "index.html"));

  assert.throws(
    () => service.resolveShellAssetPath({ assetPath: "../secret.txt" }),
    /escapes the allowed root/,
  );
  assert.throws(
    () => service.resolveShellAssetPath({ shellId: "../custom-shell", assetPath: "index.html" }),
    /Shell not found|Invalid shell id/,
  );

  fs.rmSync(home, { recursive: true, force: true });
});

test("shell paths: empty shell asset path resolves shell entry", () => {
  const home = tmpHome();
  const shellRoot = path.join(home, "shells", "custom-shell");
  fs.mkdirSync(path.join(shellRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(shellRoot, "index.html"), "root index", "utf8");
  fs.writeFileSync(path.join(shellRoot, "dist", "index.html"), "dist entry", "utf8");

  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });
  service.updateUserContent({
    shells: [
      {
        id: "custom-shell",
        name: "Custom Shell",
        source: "user",
        entry: "dist/index.html",
      },
    ],
    activeShell: "custom-shell",
  });

  const resolved = service.resolveShellAssetPath({ shellId: "custom-shell" });
  assert.equal(resolved.filePath, path.join(shellRoot, "dist", "index.html"));

  fs.rmSync(home, { recursive: true, force: true });
});

test("server: /shells/<id>/ serves shell entry when asset path is empty", async (t) => {
  const home = tmpHome();
  const shellRoot = path.join(home, "shells", "custom-shell");
  fs.mkdirSync(path.join(shellRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(shellRoot, "index.html"), "root index", "utf8");
  fs.writeFileSync(path.join(shellRoot, "dist", "index.html"), "dist entry", "utf8");

  const service = new SmallPhoneService({
    smallphoneHome: home,
    runtime: { mode: "mock" },
  });
  service.updateUserContent({
    shells: [
      {
        id: "custom-shell",
        name: "Custom Shell",
        source: "user",
        entry: "dist/index.html",
      },
    ],
    activeShell: "custom-shell",
  });

  let port = 0;
  try {
    port = await getFreePort();
  } catch (err) {
    if (String(err?.code) === "EPERM") {
      t.skip("network listen not permitted in this environment");
      fs.rmSync(home, { recursive: true, force: true });
      return;
    }
    throw err;
  }
  const child = spawn(process.execPath, ["./apps/core/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      SMALLPHONE_HOME: home,
      SMALLPHONE_HOST: "127.0.0.1",
      SMALLPHONE_HOSTS: "127.0.0.1",
      SMALLPHONE_PORT: String(port),
      SMALLPHONE_RUNTIME_MODE: "mock",
      SMALLPHONE_TASK_WORKER_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    const response = await fetch(`http://127.0.0.1:${port}/shells/custom-shell/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "dist entry");
  } finally {
    await stopServer(child);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
