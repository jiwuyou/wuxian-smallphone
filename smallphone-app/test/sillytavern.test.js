const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkSillyTavernGithubConnectivity,
  parseGitLsRemoteOutput,
  resolveSillyTavernServiceRecord,
} = require("../packages/domain/sillytavern");

test("sillytavern github parser recognizes branch refs", () => {
  const parsed = parseGitLsRemoteOutput([
    "0123456789abcdef0123456789abcdef01234567\trefs/heads/main",
    "abcdefabcdefabcdefabcdefabcdefabcdefabcd\trefs/tags/v1.0.0",
    "ffffffffffffffffffffffffffffffffffffffff refs/heads/release",
  ].join("\n"));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.branchCount, 2);
  assert.deepEqual(parsed.branches, ["main", "release"]);
});

test("sillytavern github connectivity reports failed command without network", async () => {
  const status = await checkSillyTavernGithubConnectivity({
    repoUrl: "https://github.invalid/SillyTavern/SillyTavern.git",
    runner: async (command, args, options) => {
      assert.equal(command, "git");
      assert.deepEqual(args, ["ls-remote", "--heads", "https://github.invalid/SillyTavern/SillyTavern.git"]);
      assert.equal(options.timeoutMs, 15000);
      return {
        exitCode: 128,
        timedOut: false,
        output: "fatal: unable to access repository",
        error: "git failed",
      };
    },
  });

  assert.equal(status.ok, false);
  assert.equal(status.reachable, false);
  assert.equal(status.exitCode, 128);
  assert.equal(status.error, "git failed");
});

test("sillytavern service resolver matches app tag", () => {
  const service = resolveSillyTavernServiceRecord([
    { id: "other", tags: ["smallphone-app:other"] },
    { id: "svc-st", tags: ["smallphone-app:sillytavern"] },
  ]);

  assert.equal(service.id, "svc-st");
});
