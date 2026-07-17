"use strict";

const fs = require("fs");

const configFile =
  process.env.SMALLPHONE_SERVICE_MANAGER_CONFIG_FILE ||
  "/data/data/com.termux/files/home/.config/openhouseai/service-manager/config.json";

let config;
try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (error) {
  throw new Error(`Unable to read Termux service-manager config at ${configFile}: ${error.message}`);
}

const token = String(config.auth_token || "").trim();
if (!token) {
  throw new Error(`Termux service-manager config has no auth_token: ${configFile}`);
}

process.env.SMALLPHONE_SERVICE_MANAGER_TOKEN = token;
require("./server.js");
