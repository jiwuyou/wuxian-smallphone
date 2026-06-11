const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const packageJson = require("../package.json");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-health-"));
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

test("server: exposes stable public health hooks without leaking launch secrets", async (t) => {
  const home = tmpHome();
  const secretToken = "health-service-manager-token";
  const secretCommand = path.join(home, "secret-openclaw-command");
  const secretEntry = path.join(home, "secret-openclaw-entry.mjs");
  fs.writeFileSync(secretEntry, "module.exports = {};\n", "utf8");

  let port = 0;
  try {
    port = await getFreePort();
  } catch (err) {
    fs.rmSync(home, { recursive: true, force: true });
    if (String(err?.code) === "EPERM") {
      t.skip("network listen not permitted in this environment");
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
      SMALLPHONE_RUNTIME_MODE: "openclaw-cli",
      SMALLPHONE_OPENCLAW_COMMAND: secretCommand,
      SMALLPHONE_OPENCLAW_ENTRY: secretEntry,
      SMALLPHONE_SERVICE_MANAGER_TOKEN: secretToken,
      SMALLPHONE_TASK_WORKER_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();

    assert.equal(health.ok, true);
    assert.equal(health.app, "smallphone");
    assert.equal(health.name, "SmallPhone");
    assert.equal(health.version, packageJson.version);
    assert.equal(health.runtime.id, "openclaw-cli");
    assert.equal(health.serviceManager.configured, true);
    assert.equal("command" in health.runtime, false);
    assert.equal("entry" in health.runtime, false);

    const serialized = JSON.stringify(health);
    assert.equal(serialized.includes(secretToken), false);
    assert.equal(serialized.includes(secretCommand), false);
    assert.equal(serialized.includes(secretEntry), false);

    const apiHealthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { origin: "http://example.invalid" },
    });
    assert.equal(apiHealthResponse.status, 200);
    assert.equal(apiHealthResponse.headers.get("access-control-allow-origin"), "http://example.invalid");
    assert.equal((await apiHealthResponse.json()).ok, true);
  } finally {
    await stopServer(child);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
