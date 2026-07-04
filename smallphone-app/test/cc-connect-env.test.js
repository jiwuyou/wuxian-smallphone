const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  applyCcConnectEnvDefaults,
  buildCcConnectConfigCandidates,
} = require("../apps/core/cc-connect-env");

test("cc-connect config candidates include openhouse-connect generated config", () => {
  const candidates = buildCcConnectConfigCandidates("/root/.smallphoneai/cc-connect.toml");

  assert.ok(candidates.includes("/root/.smallphoneai/cc-connect.toml"));
  assert.ok(candidates.includes("/root/smallphoneai-repos/openhouse-connect/config.smallphoneai.toml"));
});

test("cc-connect env defaults to cc-webclient on localhost backend without leaking browser config", () => {
  const configFile = tmpConfigFile("");
  try {
    const env = {
      CC_CONNECT_CONFIG_FILE: configFile,
      OPENHOUSE_WEBCLIENT_TOKEN: "openhouse-webclient-secret",
    };

    applyCcConnectEnvDefaults(env);

    assert.equal(env.SMALLPHONE_RUNTIME_MODE, "cc-webclient");
    assert.equal(env.SMALLPHONE_WEBCLIENT_BASE_URL, "http://127.0.0.1:21030");
    assert.equal(env.SMALLPHONE_WEBCLIENT_TOKEN, "openhouse-webclient-secret");
    assert.equal(env.SMALLPHONE_WEBCLIENT_APP_ID, "smallphone");
    assert.equal(env.SMALLPHONE_CCCONNECT_PLATFORM, "web-smallphone");
  } finally {
    fs.rmSync(path.dirname(configFile), { recursive: true, force: true });
  }
});

test("cc-connect env expands webclient token from environment references", () => {
  const configFile = tmpConfigFile(`
[webclient]
enabled = true
host = "0.0.0.0"
port = 21031
token = "\${OPENHOUSE_WEBCLIENT_TOKEN}"

[[webclient.apps]]
id = "smallphone"

[management]
port = 21020
token = "$OPENHOUSE_MANAGEMENT_TOKEN"

[[projects]]
name = "smallphone-pi"
display_name = "smallphone"
`);
  try {
    const env = {
      CC_CONNECT_CONFIG_FILE: configFile,
      OPENHOUSE_WEBCLIENT_TOKEN: "resolved-webclient-secret",
      OPENHOUSE_MANAGEMENT_TOKEN: "resolved-management-secret",
    };

    applyCcConnectEnvDefaults(env);

    assert.equal(env.SMALLPHONE_RUNTIME_MODE, "cc-webclient");
    assert.equal(env.SMALLPHONE_WEBCLIENT_BASE_URL, "http://127.0.0.1:21031");
    assert.equal(env.SMALLPHONE_WEBCLIENT_TOKEN, "resolved-webclient-secret");
    assert.equal(env.SMALLPHONE_WEBCLIENT_APP_ID, "smallphone");
    assert.equal(env.SMALLPHONE_CCCONNECT_PROJECT, "smallphone-pi");
    assert.equal(env.SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN, "resolved-management-secret");
  } finally {
    fs.rmSync(path.dirname(configFile), { recursive: true, force: true });
  }
});

function tmpConfigFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-cc-env-"));
  const configFile = path.join(dir, "cc-connect.toml");
  fs.writeFileSync(configFile, content, "utf8");
  return configFile;
}
