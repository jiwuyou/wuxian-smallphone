#!/usr/bin/env bash
set -euo pipefail

ACTIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$ACTIVE_DIR/.." && pwd)"
OPENCODE_DIR="$ROOT_DIR/opencode"
FRONTEND_DIR="$ACTIVE_DIR/generic-mini-phone"
BETA_FRONTEND_DIR="${BETA_FRONTEND_DIR:-$ACTIVE_DIR/generic-mini-phone-beta}"
APP_BACKEND_DIR="$ACTIVE_DIR/smallphone-app"
SMALLPHONE_HOME="${SMALLPHONE_HOME:-$ROOT_DIR/smallphone-home}"
RUNTIME_HOME="${RUNTIME_HOME:-/tmp/opencode-home}"
RUNTIME_DATA="${RUNTIME_DATA:-/tmp/opencode-data}"
RUNTIME_CACHE="${RUNTIME_CACHE:-/tmp/opencode-cache}"
RUNTIME_CONFIG="${RUNTIME_CONFIG:-/tmp/opencode-config}"
RUNTIME_STATE="${RUNTIME_STATE:-/tmp/opencode-state}"
OPENCODE_DATA_DIR="$RUNTIME_DATA/opencode"
OPENCODE_CONFIG_DIR="$RUNTIME_CONFIG/opencode"
TAILSCALE_IP="$(hostname -I | tr ' ' '\n' | grep '^100\.' | head -n 1 || true)"
PRIMARY_IP="$(hostname -I | tr ' ' '\n' | grep -Ev '^(127\.|172\.17\.)' | head -n 1 || true)"
LOCAL_HOST="${LOCAL_HOST:-127.0.0.1}"
START_LOCAL_LISTENERS="${START_LOCAL_LISTENERS:-1}"
BACKEND_HOST="${BACKEND_HOST:-${TAILSCALE_IP:-${PRIMARY_IP:-127.0.0.1}}}"
BACKEND_PORT="${BACKEND_PORT:-22096}"
APP_BACKEND_HOST="${APP_BACKEND_HOST:-$BACKEND_HOST}"
APP_BACKEND_HOSTS="${APP_BACKEND_HOSTS:-$APP_BACKEND_HOST}"
APP_BACKEND_PORT="${APP_BACKEND_PORT:-22000}"
FRONTEND_HOST="${FRONTEND_HOST:-$BACKEND_HOST}"
FRONTEND_PORT="${FRONTEND_PORT:-22080}"
BETA_FRONTEND_HOST="${BETA_FRONTEND_HOST:-$FRONTEND_HOST}"
BETA_FRONTEND_PORT="${BETA_FRONTEND_PORT:-22082}"
CODEX_CONFIG_FILE="${CODEX_CONFIG_FILE:-/root/.codex/config.toml}"
CC_CONNECT_CONFIG_FILE="${CC_CONNECT_CONFIG_FILE:-/root/.smallphoneai/cc-connect.toml}"
SMALLPHONE_PROVIDER_ID="${SMALLPHONE_PROVIDER_ID:-smallphone}"
SMALLPHONE_RUNTIME_MODE="${SMALLPHONE_RUNTIME_MODE:-cc-connect}"
SMALLPHONE_CCCONNECT_PLATFORM="${SMALLPHONE_CCCONNECT_PLATFORM:-smallphone}"
SMALLPHONE_SERVICE_MANAGER_URL="${SMALLPHONE_SERVICE_MANAGER_URL:-${SERVICE_MANAGER_URL:-http://127.0.0.1:20087}}"
if [[ -z "${SMALLPHONE_SERVICE_MANAGER_TOKEN:-}" ]]; then
  if [[ -n "${SERVICE_MANAGER_TOKEN:-}" ]]; then
    SMALLPHONE_SERVICE_MANAGER_TOKEN="$SERVICE_MANAGER_TOKEN"
  elif command -v service-manager >/dev/null 2>&1; then
    SMALLPHONE_SERVICE_MANAGER_TOKEN="$(service-manager token show 2>/dev/null | tr -d '\r\n' || true)"
  fi
fi
SMALLPHONE_SERVICE_MANAGER_TIMEOUT_MS="${SMALLPHONE_SERVICE_MANAGER_TIMEOUT_MS:-8000}"

if [[ "$START_LOCAL_LISTENERS" != "0" && "$APP_BACKEND_HOST" != "$LOCAL_HOST" ]]; then
  APP_BACKEND_HOSTS="${APP_BACKEND_HOSTS},${LOCAL_HOST}"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but not installed."
  echo "Install bun first: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if [[ -z "${SMALLPHONE_API_URL:-}" || -z "${SMALLPHONE_API_KEY:-}" || -z "${SMALLPHONE_MODEL:-}" ]]; then
  if [[ -f "$CODEX_CONFIG_FILE" ]]; then
    eval "$(
      python3 - <<'PY'
import os
import shlex
import tomllib

path = os.environ.get("CODEX_CONFIG_FILE", "/root/.codex/config.toml")
with open(path, "rb") as f:
    conf = tomllib.load(f)

provider_name = conf.get("model_provider", "")
provider = conf.get("model_providers", {}).get(provider_name, {})

base_url = str(provider.get("base_url", "") or "")
api_key = str(provider.get("api_key", "") or "")
model = str(
    provider.get("default_model", "")
    or conf.get("model", "")
    or ""
)

print(f"export SMALLPHONE_API_URL={shlex.quote(base_url)}")
print(f"export SMALLPHONE_API_KEY={shlex.quote(api_key)}")
print(f"export SMALLPHONE_MODEL={shlex.quote(model)}")
PY
    )"
  fi
fi

if [[ "$SMALLPHONE_RUNTIME_MODE" == "cc-connect" || "$SMALLPHONE_RUNTIME_MODE" == "ccconnect" ]]; then
  if [[ -f "$CC_CONNECT_CONFIG_FILE" ]]; then
    eval "$(
      python3 - <<'PY'
import os
import shlex
import tomllib

path = os.environ.get("CC_CONNECT_CONFIG_FILE", "/root/.smallphoneai/cc-connect.toml")
with open(path, "rb") as f:
    conf = tomllib.load(f)

bridge = conf.get("bridge", {})
management = conf.get("management", {})
project_name = os.environ.get("SMALLPHONE_CCCONNECT_PROJECT", "")
if not project_name:
    for project in conf.get("projects", []):
        name = str(project.get("name", "") or "")
        display = str(project.get("display_name", "") or "")
        if display == "smallphone" or name.startswith("smallphone"):
            project_name = name
            break

port = str(bridge.get("port", "") or "21010")
path_value = str(bridge.get("path", "") or "/bridge/ws")
token = str(bridge.get("token", "") or "")
ws_url = os.environ.get("SMALLPHONE_CCCONNECT_WS_URL", "") or f"ws://127.0.0.1:{port}{path_value}"
management_port = str(management.get("port", "") or "21020")
management_token = str(management.get("token", "") or "")
management_url = os.environ.get("SMALLPHONE_CCCONNECT_MANAGEMENT_URL", "") or f"http://127.0.0.1:{management_port}"

if ws_url:
    print(f"export SMALLPHONE_CCCONNECT_WS_URL={shlex.quote(ws_url)}")
if token and not os.environ.get("SMALLPHONE_CCCONNECT_TOKEN"):
    print(f"export SMALLPHONE_CCCONNECT_TOKEN={shlex.quote(token)}")
if management_url:
    print(f"export SMALLPHONE_CCCONNECT_MANAGEMENT_URL={shlex.quote(management_url)}")
if management_token and not os.environ.get("SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN"):
    print(f"export SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN={shlex.quote(management_token)}")
if project_name:
    print(f"export SMALLPHONE_CCCONNECT_PROJECT={shlex.quote(project_name)}")
PY
    )"
  fi
fi

if [[ "$SMALLPHONE_RUNTIME_MODE" == "cc-webclient" || "$SMALLPHONE_RUNTIME_MODE" == "cc_webclient" || "$SMALLPHONE_RUNTIME_MODE" == "ccwebclient" ]]; then
  if [[ -f "$CC_CONNECT_CONFIG_FILE" ]]; then
    eval "$(
      python3 - <<'PY'
import os
import shlex
import tomllib

path = os.environ.get("CC_CONNECT_CONFIG_FILE", "/root/.smallphoneai/cc-connect.toml")
with open(path, "rb") as f:
    conf = tomllib.load(f)

webclient = conf.get("webclient", {}) or {}
management = conf.get("management", {}) or {}

project_name = os.environ.get("SMALLPHONE_CCCONNECT_PROJECT", "")
if not project_name:
    for project in conf.get("projects", []):
        name = str(project.get("name", "") or "")
        display = str(project.get("display_name", "") or "")
        if display == "smallphone" or name.startswith("smallphone"):
            project_name = name
            break

port = str(webclient.get("port", "") or "21040")
token = str(webclient.get("token", "") or "")
app_id = (os.environ.get("SMALLPHONE_WEBCLIENT_APP_ID", "") or "").strip()
if not app_id:
    app_id = "smallphone"

base_url_env = (os.environ.get("SMALLPHONE_WEBCLIENT_BASE_URL", "") or "").strip()
base_url = base_url_env or f"http://127.0.0.1:{port}"

management_port = str(management.get("port", "") or "21020")
management_token = str(management.get("token", "") or "")
management_url = os.environ.get("SMALLPHONE_CCCONNECT_MANAGEMENT_URL", "") or f"http://127.0.0.1:{management_port}"

if base_url:
    print(f"export SMALLPHONE_WEBCLIENT_BASE_URL={shlex.quote(base_url)}")
if token and not os.environ.get("SMALLPHONE_WEBCLIENT_TOKEN"):
    print(f"export SMALLPHONE_WEBCLIENT_TOKEN={shlex.quote(token)}")
if app_id:
    print(f"export SMALLPHONE_WEBCLIENT_APP_ID={shlex.quote(app_id)}")
if management_url:
    print(f"export SMALLPHONE_CCCONNECT_MANAGEMENT_URL={shlex.quote(management_url)}")
if management_token and not os.environ.get("SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN"):
    print(f"export SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN={shlex.quote(management_token)}")
if project_name:
    print(f"export SMALLPHONE_CCCONNECT_PROJECT={shlex.quote(project_name)}")
PY
    )"
  fi
fi

prepare_smallphone_home() {
  mkdir -p \
    "$SMALLPHONE_HOME" \
    "$SMALLPHONE_HOME/attachments" \
    "$SMALLPHONE_HOME/channel-workspaces" \
    "$SMALLPHONE_HOME/admin-workspaces" \
    "$SMALLPHONE_HOME/system-workspace" \
    "$SMALLPHONE_HOME/shells" \
    "$SMALLPHONE_HOME/apps" \
    "$SMALLPHONE_HOME/themes" \
    "$SMALLPHONE_HOME/desktop-layouts"
}

prepare_opencode_runtime() {
  mkdir -p "$RUNTIME_HOME" "$RUNTIME_DATA" "$RUNTIME_CACHE" "$RUNTIME_CONFIG" "$RUNTIME_STATE" "$OPENCODE_DATA_DIR" "$OPENCODE_CONFIG_DIR"

  if [[ -n "${SMALLPHONE_API_URL:-}" && -n "${SMALLPHONE_API_KEY:-}" && -n "${SMALLPHONE_MODEL:-}" ]]; then
    export SMALLPHONE_PROVIDER_ID SMALLPHONE_API_URL SMALLPHONE_API_KEY SMALLPHONE_MODEL OPENCODE_CONFIG_DIR OPENCODE_DATA_DIR
    python3 - <<'PY'
import json
import os
from pathlib import Path

provider_id = os.environ["SMALLPHONE_PROVIDER_ID"]
api_url = os.environ["SMALLPHONE_API_URL"]
api_key = os.environ["SMALLPHONE_API_KEY"]
model_id = os.environ["SMALLPHONE_MODEL"]
config_dir = Path(os.environ["OPENCODE_CONFIG_DIR"])
data_dir = Path(os.environ["OPENCODE_DATA_DIR"])

config = {
    "$schema": "https://opencode.ai/config.json",
    "model": f"{provider_id}/{model_id}",
    "small_model": f"{provider_id}/{model_id}",
    "provider": {
        provider_id: {
            "name": "Smallphone Runtime",
            "api": api_url,
            "env": [],
            "options": {
                "baseURL": api_url,
            },
            "models": {
                model_id: {
                    "id": model_id,
                    "name": model_id,
                    "reasoning": True,
                    "temperature": True,
                    "tool_call": True,
                    "modalities": {
                        "input": ["text"],
                        "output": ["text"],
                    },
                    "limit": {
                        "context": 128000,
                        "output": 16384,
                    },
                }
            },
        }
    },
}

auth = {
    provider_id: {
        "type": "api",
        "key": api_key,
    }
}

(config_dir / "opencode.json").write_text(json.dumps(config, ensure_ascii=False, indent=2))
(data_dir / "auth.json").write_text(json.dumps(auth, ensure_ascii=False, indent=2))
PY
  fi
}

cleanup() {
  if [[ -n "${APP_BACKEND_PID:-}" ]]; then
    kill "${APP_BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BETA_FRONTEND_PID:-}" ]]; then
    kill "${BETA_FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_FRONTEND_PID:-}" ]]; then
    kill "${LOCAL_FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_BETA_FRONTEND_PID:-}" ]]; then
    kill "${LOCAL_BETA_FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

prepare_smallphone_home

echo "Starting smallphone app API on ${APP_BACKEND_HOSTS}:${APP_BACKEND_PORT}"
(
  cd "$APP_BACKEND_DIR"
  SMALLPHONE_HOME="$SMALLPHONE_HOME" \
  SMALLPHONE_HOST="$APP_BACKEND_HOST" \
  SMALLPHONE_HOSTS="$APP_BACKEND_HOSTS" \
  SMALLPHONE_PORT="$APP_BACKEND_PORT" \
  SMALLPHONE_RUNTIME_MODE="$SMALLPHONE_RUNTIME_MODE" \
  SMALLPHONE_CCCONNECT_WS_URL="${SMALLPHONE_CCCONNECT_WS_URL:-}" \
  SMALLPHONE_CCCONNECT_TOKEN="${SMALLPHONE_CCCONNECT_TOKEN:-}" \
  SMALLPHONE_CCCONNECT_PROJECT="${SMALLPHONE_CCCONNECT_PROJECT:-}" \
  SMALLPHONE_CCCONNECT_PLATFORM="$SMALLPHONE_CCCONNECT_PLATFORM" \
  SMALLPHONE_CCCONNECT_MANAGEMENT_URL="${SMALLPHONE_CCCONNECT_MANAGEMENT_URL:-}" \
  SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN="${SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN:-}" \
  SMALLPHONE_SERVICE_MANAGER_URL="$SMALLPHONE_SERVICE_MANAGER_URL" \
  SMALLPHONE_SERVICE_MANAGER_TOKEN="${SMALLPHONE_SERVICE_MANAGER_TOKEN:-}" \
  SMALLPHONE_SERVICE_MANAGER_TIMEOUT_MS="$SMALLPHONE_SERVICE_MANAGER_TIMEOUT_MS" \
  SMALLPHONE_WEBCLIENT_BASE_URL="${SMALLPHONE_WEBCLIENT_BASE_URL:-}" \
  SMALLPHONE_WEBCLIENT_TOKEN="${SMALLPHONE_WEBCLIENT_TOKEN:-}" \
  SMALLPHONE_WEBCLIENT_APP_ID="${SMALLPHONE_WEBCLIENT_APP_ID:-}" \
  SMALLPHONE_CLIENT_ID="${SMALLPHONE_CLIENT_ID:-smallphone}" \
  SMALLPHONE_APP_ID="${SMALLPHONE_APP_ID:-chat}" \
  node ./apps/core/server.js
) &
APP_BACKEND_PID=$!

echo "Starting smallphone backend on http://${BACKEND_HOST}:${BACKEND_PORT}"
(
  cd "$OPENCODE_DIR"
  prepare_opencode_runtime
  export SMALLPHONE_API_URL SMALLPHONE_API_KEY SMALLPHONE_MODEL
  HOME="$RUNTIME_HOME" \
  XDG_DATA_HOME="$RUNTIME_DATA" \
  XDG_CACHE_HOME="$RUNTIME_CACHE" \
  XDG_CONFIG_HOME="$RUNTIME_CONFIG" \
  XDG_STATE_HOME="$RUNTIME_STATE" \
  bun --cwd packages/opencode src/index.ts serve --hostname "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

echo "Starting smallphone frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT}"
(
  cd "$FRONTEND_DIR"
  python3 -m http.server "$FRONTEND_PORT" --bind "$FRONTEND_HOST"
) &
FRONTEND_PID=$!

if [[ "$START_LOCAL_LISTENERS" != "0" && "$FRONTEND_HOST" != "$LOCAL_HOST" ]]; then
  echo "Starting smallphone local frontend on http://${LOCAL_HOST}:${FRONTEND_PORT}"
  (
    cd "$FRONTEND_DIR"
    python3 -m http.server "$FRONTEND_PORT" --bind "$LOCAL_HOST"
  ) &
  LOCAL_FRONTEND_PID=$!
fi

if [[ -d "$BETA_FRONTEND_DIR" ]]; then
  echo "Starting smallphone beta frontend on http://${BETA_FRONTEND_HOST}:${BETA_FRONTEND_PORT}"
  (
    cd "$BETA_FRONTEND_DIR"
    python3 -m http.server "$BETA_FRONTEND_PORT" --bind "$BETA_FRONTEND_HOST"
  ) &
  BETA_FRONTEND_PID=$!

  if [[ "$START_LOCAL_LISTENERS" != "0" && "$BETA_FRONTEND_HOST" != "$LOCAL_HOST" ]]; then
    echo "Starting smallphone local beta frontend on http://${LOCAL_HOST}:${BETA_FRONTEND_PORT}"
    (
      cd "$BETA_FRONTEND_DIR"
      python3 -m http.server "$BETA_FRONTEND_PORT" --bind "$LOCAL_HOST"
    ) &
    LOCAL_BETA_FRONTEND_PID=$!
  fi
fi

echo
echo "Frontend stable: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
if [[ -n "${LOCAL_FRONTEND_PID:-}" ]]; then
  echo "Frontend stable local: http://${LOCAL_HOST}:${FRONTEND_PORT}"
fi
if [[ -n "${BETA_FRONTEND_PID:-}" ]]; then
  echo "Frontend beta:   http://${BETA_FRONTEND_HOST}:${BETA_FRONTEND_PORT}"
fi
if [[ -n "${LOCAL_BETA_FRONTEND_PID:-}" ]]; then
  echo "Frontend beta local: http://${LOCAL_HOST}:${BETA_FRONTEND_PORT}"
fi
echo "API:      http://${APP_BACKEND_HOST}:${APP_BACKEND_PORT}/api"
if [[ "$START_LOCAL_LISTENERS" != "0" && "$APP_BACKEND_HOST" != "$LOCAL_HOST" ]]; then
  echo "API local: http://${LOCAL_HOST}:${APP_BACKEND_PORT}/api"
fi
echo "Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "SmallPhone home: $SMALLPHONE_HOME"
echo
echo "Press Ctrl+C to stop all services."

WAIT_PIDS=("$APP_BACKEND_PID" "$BACKEND_PID" "$FRONTEND_PID")
if [[ -n "${LOCAL_FRONTEND_PID:-}" ]]; then
  WAIT_PIDS+=("$LOCAL_FRONTEND_PID")
fi
if [[ -n "${BETA_FRONTEND_PID:-}" ]]; then
  WAIT_PIDS+=("$BETA_FRONTEND_PID")
fi
if [[ -n "${LOCAL_BETA_FRONTEND_PID:-}" ]]; then
  WAIT_PIDS+=("$LOCAL_BETA_FRONTEND_PID")
fi
wait "${WAIT_PIDS[@]}"
