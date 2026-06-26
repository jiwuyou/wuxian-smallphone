const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildApkReleaseManifestUrls,
  checkApkReleaseManifest,
  normalizeApkReleaseManifest,
  readApkReleaseServerSettings,
  writeApkReleaseServerSettings,
} = require("../packages/domain/apk-release");
const { resolveSmallPhonePaths } = require("../packages/shared/paths");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-apk-release-"));
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("apk release settings are stored in the OpenHouseAI settings file", () => {
  const home = tmpHome();
  const paths = resolveSmallPhonePaths({ smallphoneHome: home });

  try {
    const written = writeApkReleaseServerSettings(
      {
        releaseServerBaseUrl: "https://updates.example.test/releases/",
        channel: "beta",
      },
      { paths, now: "2026-06-26T00:00:00.000Z" },
    );

    assert.equal(written.settings.releaseServerBaseUrl, "https://updates.example.test/releases");
    assert.equal(written.settings.channel, "beta");
    assert.equal(written.settings.updatedAt, "2026-06-26T00:00:00.000Z");

    const document = JSON.parse(fs.readFileSync(paths.openhouseAiSettingsFile, "utf8"));
    assert.equal(document.kind, "openhouseai.settings");
    assert.equal(document.releaseServerBaseUrl, "https://updates.example.test/releases");
    assert.equal(document.channel, "beta");
    assert.equal(document.updatedAt, "2026-06-26T00:00:00.000Z");

    const reloaded = readApkReleaseServerSettings({ paths });
    assert.deepEqual(reloaded.settings, written.settings);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("apk release manifest URL resolution supports release roots and explicit JSON URLs", () => {
  assert.deepEqual(
    buildApkReleaseManifestUrls({
      releaseServerBaseUrl: "https://updates.example.test/releases",
      channel: "stable",
    }).slice(0, 4),
    [
      "https://updates.example.test/releases/stable/manifest.json",
      "https://updates.example.test/releases/manifest-stable.json",
      "https://updates.example.test/releases/manifest.json?channel=stable",
      "https://updates.example.test/releases/release-manifest.json?channel=stable",
    ],
  );

  assert.deepEqual(
    buildApkReleaseManifestUrls({
      releaseServerBaseUrl: "https://updates.example.test/openhouse-manifest.json",
      channel: "stable",
    }),
    ["https://updates.example.test/openhouse-manifest.json"],
  );
});

test("apk release manifest normalizes a valid release payload", () => {
  const release = normalizeApkReleaseManifest(
    {
      schemaVersion: 1,
      channel: "stable",
      packageName: "com.termux",
      latestVersionCode: "42",
      latestVersionName: "1.2.3",
      apkUrl: "smallphone-1.2.3.apk",
      apkSha256: "A".repeat(64),
      apkSizeBytes: "4096",
      releaseNotes: "Bug fixes",
    },
    {
      channel: "stable",
      manifestUrl: "https://updates.example.test/apk-release/stable/manifest.json",
    },
  );

  assert.equal(release.channel, "stable");
  assert.equal(release.packageName, "com.termux");
  assert.equal(release.latestVersionCode, 42);
  assert.equal(release.latestVersionName, "1.2.3");
  assert.equal(release.versionCode, 42);
  assert.equal(release.versionName, "1.2.3");
  assert.equal(release.apkUrl, "https://updates.example.test/apk-release/stable/smallphone-1.2.3.apk");
  assert.equal(release.apkSha256, "a".repeat(64));
  assert.equal(release.apkSizeBytes, 4096);
  assert.equal(release.sizeBytes, 4096);
  assert.equal(release.fileName, "smallphone-1.2.3.apk");
});

test("apk release manifest rejects bad payloads", () => {
  const validManifest = {
    schemaVersion: 1,
    channel: "stable",
    packageName: "com.termux",
    latestVersionCode: 42,
    latestVersionName: "1.2.3",
    apkUrl: "https://updates.example.test/app.apk",
    apkSha256: "a".repeat(64),
    apkSizeBytes: 4096,
  };
  const cases = [
    ["non-object manifest", null, /JSON object/],
    ["missing schemaVersion", { ...validManifest, schemaVersion: undefined }, /schemaVersion/],
    ["missing packageName", { ...validManifest, packageName: undefined }, /packageName/],
    ["missing APK URL", { ...validManifest, apkUrl: undefined }, /apkUrl/],
    ["bad versionCode", { ...validManifest, latestVersionCode: "v1" }, /latestVersionCode/],
    ["bad APK URL protocol", { ...validManifest, apkUrl: "file:///tmp/app.apk" }, /http or https/],
    ["missing requested channel", { ...validManifest, channel: "beta" }, /channel/],
    ["missing sha256", { ...validManifest, apkSha256: undefined }, /apkSha256/],
    [
      "bad sha256",
      { ...validManifest, apkSha256: "not-a-sha" },
      /sha256/i,
    ],
    ["bad size", { ...validManifest, apkSizeBytes: 0 }, /apkSizeBytes/],
    [
      "bad file name",
      { ...validManifest, apkFileName: "../app.apk" },
      /fileName/,
    ],
  ];

  for (const [name, manifest, pattern] of cases) {
    assert.throws(
      () => normalizeApkReleaseManifest(manifest, {
        channel: "stable",
        manifestUrl: "https://updates.example.test/apk-release/stable/manifest.json",
      }),
      pattern,
      name,
    );
  }
});

test("apk release manifest rejects web-only aliases that Android will not accept", () => {
  assert.throws(
    () => normalizeApkReleaseManifest(
      {
        schemaVersion: 1,
        channel: "stable",
        packageName: "com.termux",
        versionCode: 42,
        versionName: "1.2.3",
        apkUrl: "https://updates.example.test/app.apk",
        apkSha256: "a".repeat(64),
        sizeBytes: 4096,
      },
      {
        channel: "stable",
        manifestUrl: "https://updates.example.test/apk-release/stable/manifest.json",
      },
    ),
    /latestVersionCode/,
  );

  assert.throws(
    () => normalizeApkReleaseManifest(
      {
        schemaVersion: 1,
        channel: "stable",
        release: {
          packageName: "com.termux",
          latestVersionCode: 42,
          latestVersionName: "1.2.3",
          apkUrl: "https://updates.example.test/app.apk",
          apkSha256: "a".repeat(64),
          apkSizeBytes: 4096,
        },
      },
      {
        channel: "stable",
        manifestUrl: "https://updates.example.test/apk-release/stable/manifest.json",
      },
    ),
    /latestVersionCode/,
  );
});

test("apk release check falls back across remote manifest candidates", async () => {
  const home = tmpHome();
  const paths = resolveSmallPhonePaths({ smallphoneHome: home });
  writeApkReleaseServerSettings(
    { releaseServerBaseUrl: "https://updates.example.test", channel: "stable" },
    { paths, now: "2026-06-26T00:00:00.000Z" },
  );

  const calls = [];
  try {
    const result = await checkApkReleaseManifest({
      paths,
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return jsonResponse(404, { error: "not found" });
        }
        return jsonResponse(200, {
          schemaVersion: 1,
          channel: "stable",
          packageName: "com.termux",
          latestVersionCode: 7,
          latestVersionName: "0.0.7",
          apkUrl: "https://updates.example.test/downloads/smallphone.apk",
          apkSha256: "b".repeat(64),
          apkSizeBytes: 4096,
        });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(result.release.versionCode, 7);
    assert.equal(result.release.apkSha256, "b".repeat(64));
    assert.equal(result.attempts[0].statusCode, 404);
    assert.equal(result.attempts[1].ok, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("apk release check reports bad remote manifests without throwing", async () => {
  const home = tmpHome();
  const paths = resolveSmallPhonePaths({ smallphoneHome: home });
  writeApkReleaseServerSettings(
    { releaseServerBaseUrl: "https://updates.example.test/openhouse-manifest.json", channel: "stable" },
    { paths, now: "2026-06-26T00:00:00.000Z" },
  );

  try {
    const result = await checkApkReleaseManifest({
      paths,
      fetchImpl: async () => jsonResponse(200, {
        schemaVersion: 1,
        channel: "stable",
        packageName: "com.termux",
        latestVersionCode: 7,
        latestVersionName: "0.0.7",
        apkSha256: "b".repeat(64),
        apkSizeBytes: 4096,
      }),
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /apkUrl/);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].statusCode, 200);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
