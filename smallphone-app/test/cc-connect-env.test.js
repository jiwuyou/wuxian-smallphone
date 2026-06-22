const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCcConnectConfigCandidates } = require("../apps/core/cc-connect-env");

test("cc-connect config candidates include openhouse-connect generated config", () => {
  const candidates = buildCcConnectConfigCandidates("/root/.smallphoneai/cc-connect.toml");

  assert.ok(candidates.includes("/root/.smallphoneai/cc-connect.toml"));
  assert.ok(candidates.includes("/root/smallphoneai-repos/openhouse-connect/config.smallphoneai.toml"));
});
