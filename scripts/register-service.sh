#!/bin/sh
set -eu

log() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

SCRIPT_DIR=$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
PARENT_DIR=$(cd "$ROOT_DIR/.." >/dev/null 2>&1 && pwd)

have() { command -v "$1" >/dev/null 2>&1; }

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

resolve_sm_url() {
  raw="${SERVICE_MANAGER_URL:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  raw="${SMALLPHONE_SERVICE_MANAGER_URL:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  printf '%s' "http://127.0.0.1:20087"
}

resolve_sm_token() {
  raw="${SERVICE_MANAGER_TOKEN:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  raw="${SMALLPHONE_SERVICE_MANAGER_TOKEN:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  if have service-manager; then
    # Capture token without printing it.
    service-manager token show 2>/dev/null | tr -d '\r\n' || true
    return 0
  fi
  printf '%s' ""
}

resolve_smallphone_sm_token() {
  raw="${SMALLPHONE_SERVICE_MANAGER_TOKEN:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  raw="${SERVICE_MANAGER_TOKEN:-}"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi
  if have service-manager; then
    # Capture token without printing it.
    service-manager token show 2>/dev/null | tr -d '\r\n' || true
    return 0
  fi
  printf '%s' ""
}

print_intended_services() {
  group_tag="group:local-stack"

  core_port="${APP_BACKEND_PORT:-${SMALLPHONE_PORT:-22000}}"
  core_host="${APP_BACKEND_HOST:-${SMALLPHONE_HOST:-127.0.0.1}}"

  frontend_port="${FRONTEND_PORT:-22080}"
  frontend_host="${FRONTEND_HOST:-127.0.0.1}"

  beta_port="${BETA_FRONTEND_PORT:-22082}"
  beta_host="${BETA_FRONTEND_HOST:-$frontend_host}"

  backend_port="${BACKEND_PORT:-22096}"
  backend_host="${BACKEND_HOST:-127.0.0.1}"

  log "Intended services (name | bind | tags):"
  log "  smallphone-core | ${core_host}:${core_port} | ${group_tag}, openhouse-component:smallphone-core"
  log "  smallphone-frontend | ${frontend_host}:${frontend_port} | ${group_tag}, openhouse-component:smallphone-frontend"
  log "  smallphone-frontend-beta | ${beta_host}:${beta_port} | ${group_tag}, openhouse-component:smallphone-frontend-beta"
  log "  smallphone-backend | ${backend_host}:${backend_port} | ${group_tag}, openhouse-component:smallphone-backend"
  log "  smallphone-standalone-diary | 127.0.0.1:23001 | ${group_tag}, openhouse-component:smallphone-standalone, smallphone-app:diary"
  log "  smallphone-standalone-like-girl | 127.0.0.1:23003 | ${group_tag}, openhouse-component:smallphone-standalone, smallphone-app:like-girl"
  log "  smallphone-standalone-like-girl-clone | 127.0.0.1:23008 | ${group_tag}, openhouse-component:smallphone-standalone, smallphone-app:like-girl-clone"
  log "  smallphone-standalone-album | 127.0.0.1:23004 | ${group_tag}, openhouse-component:smallphone-standalone, smallphone-app:album"
  log "  smallphone-like-girl-source | 127.0.0.1:23002 | ${group_tag}, openhouse-component:smallphone-standalone, smallphone-kind:source-app"
  log ""
  log "Notes:"
  log "  - smallphone-core port is SMALLPHONE_PORT (default 22000) or APP_BACKEND_PORT."
  log "  - frontends are served via python3 -m http.server; ports match start_smallphone.sh defaults."
  log "  - smallphone-backend is the OpenCode bun backend (optional; only registered if present)."
  log "  - standalone apps use PORT/HOST env vars; defaults are from each smallphone.app.json."
}

ensure_work_dir() {
  umask 077
  tmp_base="${TMPDIR:-/tmp}"
  if ! have mktemp; then
    return 1
  fi
  mktemp -d "${tmp_base%/}/smallphone-sm.XXXXXX" 2>/dev/null || true
}

write_curl_cfg() {
  cfg_path="$1"
  token="$2"
  # Use a curl config file so bearer tokens do not end up in process listings.
  printf 'header = "Authorization: Bearer %s"\n' "$token" >"$cfg_path"
  printf 'header = "Content-Type: application/json"\n' >>"$cfg_path"
}

service_name_to_id() {
  py="$1"
  name="$2"
  "${py}" -c '
import json
import sys

name = sys.argv[1]
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(0)

try:
    payload = json.loads(raw)
except Exception:
    sys.exit(0)

services = []
if isinstance(payload, list):
    services = payload
elif isinstance(payload, dict):
    if isinstance(payload.get("services"), list):
        services = payload["services"]
    elif isinstance(payload.get("data"), list):
        services = payload["data"]
    elif isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("services"), list):
        services = payload["data"]["services"]

for svc in services:
    if not isinstance(svc, dict):
        continue
    spec = svc.get("spec")
    if isinstance(spec, dict) and spec.get("name") == name:
        sid = svc.get("id")
        if isinstance(sid, str) and sid:
            sys.stdout.write(sid)
            break
' "$name"
}

emit_spec() {
  py="$1"
  key="$2"
  core_host="$3"
  core_port="$4"
  frontend_host="$5"
  frontend_port="$6"
  beta_host="$7"
  beta_port="$8"
  backend_host="$9"
  backend_port="${10}"
  service_manager_url="${11}"
  service_manager_token="${12}"
  "${py}" - "$key" "$ROOT_DIR" "$PARENT_DIR" \
    "$core_host" "$core_port" \
    "$frontend_host" "$frontend_port" \
    "$beta_host" "$beta_port" \
    "$backend_host" "$backend_port" \
    "$service_manager_url" \
    "$service_manager_token" <<'PY'
import json
import sys
from pathlib import Path

(
    key,
    root_dir,
    parent_dir,
    core_host,
    core_port,
    frontend_host,
    frontend_port,
    beta_host,
    beta_port,
    backend_host,
    backend_port,
    service_manager_url,
    service_manager_token,
) = sys.argv[1:]

root = Path(root_dir)
parent = Path(parent_dir)

group_tag = "group:local-stack"

def tcp_check(host: str, port: str):
    return {
        "type": "tcp",
        "address": f"{host}:{port}",
        "interval": "30s",
        "timeout": "3s",
    }

def http_check(url: str):
    return {
        "type": "http",
        "url": url,
        "interval": "30s",
        "timeout": "5s",
    }

def spec_process(name: str, desc: str, cmd: list[str], cwd: Path, env: dict, health: list, tags: list[str]):
    return {
        "name": name,
        "description": desc,
        "provider": "process",
        "command": cmd,
        "working_dir": str(cwd),
        "env": env,
        "runtime": {},
        "restart": {"mode": "always", "max_retries": 0},
        "health": health,
        "enabled": True,
        "tags": tags,
    }

if key == "smallphone-core":
    app_dir = root / "smallphone-app"
    smallphone_home = str(parent / "smallphone-home")
    spec = spec_process(
        "smallphone-core",
        "SmallPhone core API (smallphone-app)",
        ["node", "./apps/core/server.js"],
        app_dir,
        {
            "SMALLPHONE_HOME": smallphone_home,
            "SMALLPHONE_HOST": core_host,
            "SMALLPHONE_HOSTS": core_host,
            "SMALLPHONE_PORT": str(core_port),
            "SMALLPHONE_SERVICE_MANAGER_URL": service_manager_url,
            "SMALLPHONE_SERVICE_MANAGER_TOKEN": service_manager_token,
        },
        [http_check(f"http://{core_host}:{core_port}/health")],
        [group_tag, "openhouse-component:smallphone-core", "smallphone"],
    )
elif key == "smallphone-frontend":
    front_dir = root / "generic-mini-phone"
    spec = spec_process(
        "smallphone-frontend",
        "SmallPhone stable frontend (static, served by python http.server)",
        ["python3", "-m", "http.server", str(frontend_port), "--bind", str(frontend_host)],
        front_dir,
        {},
        [tcp_check(frontend_host, frontend_port)],
        [group_tag, "openhouse-component:smallphone-frontend", "smallphone"],
    )
elif key == "smallphone-frontend-beta":
    front_dir = root / "generic-mini-phone-beta"
    spec = spec_process(
        "smallphone-frontend-beta",
        "SmallPhone beta frontend (static, served by python http.server)",
        ["python3", "-m", "http.server", str(beta_port), "--bind", str(beta_host)],
        front_dir,
        {},
        [tcp_check(beta_host, beta_port)],
        [group_tag, "openhouse-component:smallphone-frontend-beta", "smallphone"],
    )
elif key == "smallphone-backend":
    opencode_dir = parent / "opencode"
    # This is optional; the caller should skip registration if the directory does not exist.
    spec = spec_process(
        "smallphone-backend",
        "SmallPhone backend (OpenCode bun server)",
        ["bun", "--cwd", "packages/opencode", "src/index.ts", "serve", "--hostname", str(backend_host), "--port", str(backend_port)],
        opencode_dir,
        {},
        [tcp_check(backend_host, backend_port)],
        [group_tag, "openhouse-component:smallphone-backend", "smallphone", "opencode"],
    )
elif key == "smallphone-standalone-diary":
    app_dir = root / "standalone-apps" / "diary"
    port = "23001"
    spec = spec_process(
        "smallphone-standalone-diary",
        "SmallPhone standalone Diary app (Node/SQLite)",
        ["node", "./src/server.js"],
        app_dir,
        {"HOST": "127.0.0.1", "PORT": port},
        [http_check(f"http://127.0.0.1:{port}/health")],
        [group_tag, "openhouse-component:smallphone-standalone", "smallphone", "smallphone-app:diary"],
    )
elif key == "smallphone-standalone-album":
    app_dir = root / "standalone-apps" / "album"
    port = "23004"
    spec = spec_process(
        "smallphone-standalone-album",
        "SmallPhone standalone Album app (Node/SQLite)",
        ["node", "./src/server.js"],
        app_dir,
        {"HOST": "127.0.0.1", "PORT": port},
        [http_check(f"http://127.0.0.1:{port}/health")],
        [group_tag, "openhouse-component:smallphone-standalone", "smallphone", "smallphone-app:album"],
    )
elif key == "smallphone-standalone-like-girl":
    app_dir = root / "standalone-apps" / "like-girl"
    port = "23003"
    spec = spec_process(
        "smallphone-standalone-like-girl",
        "SmallPhone standalone LikeGirl app (Node/SQLite)",
        ["node", "./src/server.js"],
        app_dir,
        {"HOST": "127.0.0.1", "PORT": port},
        [http_check(f"http://127.0.0.1:{port}/health")],
        [group_tag, "openhouse-component:smallphone-standalone", "smallphone", "smallphone-app:like-girl", "control-test:smallphone-likegirl"],
    )
elif key == "smallphone-standalone-like-girl-clone":
    app_dir = root / "standalone-apps" / "like-girl"
    port = "23008"
    spec = spec_process(
        "smallphone-standalone-like-girl-clone",
        "SmallPhone standalone LikeGirl clone control app (Node/SQLite)",
        ["node", "./src/server.js"],
        app_dir,
        {
            "HOST": "127.0.0.1",
            "PORT": port,
            "LIKE_GIRL_DB_FILE": "./data/instances/like-girl-clone/like-girl.sqlite",
            "LIKE_GIRL_PHOTO_UPLOADS_DIR": "./data/instances/like-girl-clone/uploads/photos",
        },
        [http_check(f"http://127.0.0.1:{port}/health")],
        [group_tag, "openhouse-component:smallphone-standalone", "smallphone", "smallphone-app:like-girl-clone", "control-test:smallphone-likegirl"],
    )
elif key == "smallphone-like-girl-source":
    app_dir = root / "standalone-apps" / "vocabulary"
    port = "23002"
    # This adapter spawns PHP; health is best-effort TCP only.
    spec = spec_process(
        "smallphone-like-girl-source",
        "SmallPhone LikeGirl source-app adapter (Node launcher + PHP built-in server)",
        ["node", "./scripts/start.mjs"],
        app_dir,
        {"HOST": "127.0.0.1", "PORT": port},
        [tcp_check("127.0.0.1", port)],
        [group_tag, "openhouse-component:smallphone-standalone", "smallphone", "smallphone-kind:source-app"],
    )
else:
    raise SystemExit(f"unknown spec key: {key}")

json.dump(spec, sys.stdout, ensure_ascii=True)
PY
}

upsert_one() {
  sm_url="$1"
  curl_cfg="$2"
  py="$3"
  svc_key="$4"
  svc_name="$5"
  spec_file="$6"

  services_json=""
  if ! services_json=$(curl -q -fsS --max-time 3 -K "$curl_cfg" "${sm_url%/}/api/v1/services" 2>/dev/null); then
    warn "service-manager: failed to list services (auth/token/server issue); skipping further registration"
    return 1
  fi

  svc_id="$(printf '%s' "$services_json" | service_name_to_id "$py" "$svc_name" 2>/dev/null || true)"

  if [ -n "$svc_id" ]; then
    log "service-manager: updating ${svc_name} (id=${svc_id})"
    if curl -q -fsS --max-time 5 -X PUT -K "$curl_cfg" --data-binary "@$spec_file" "${sm_url%/}/api/v1/services/${svc_id}" >/dev/null 2>&1; then
      curl -q -fsS --max-time 5 -X POST -K "$curl_cfg" "${sm_url%/}/api/v1/services/${svc_id}/register" >/dev/null 2>&1 || true
      return 0
    fi
    warn "service-manager: failed to update ${svc_name}; leaving existing record unchanged"
    return 0
  fi

  log "service-manager: creating ${svc_name}"
  create_resp=""
  if ! create_resp=$(curl -q -fsS --max-time 5 -X POST -K "$curl_cfg" --data-binary "@$spec_file" "${sm_url%/}/api/v1/services" 2>/dev/null); then
    warn "service-manager: failed to create ${svc_name} (check token/server logs)"
    return 0
  fi

  created_id="$(
    printf '%s' "$create_resp" | "$py" -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(0)
try:
    payload = json.loads(raw)
except Exception:
    sys.exit(0)
if isinstance(payload, dict):
    sid = payload.get("id", "")
    if isinstance(sid, str) and sid:
        sys.stdout.write(sid)
' 2>/dev/null || true
  )"
  if [ -n "$created_id" ]; then
    curl -q -fsS --max-time 5 -X POST -K "$curl_cfg" "${sm_url%/}/api/v1/services/${created_id}/register" >/dev/null 2>&1 || true
  fi

  return 0
}

print_manual_commands() {
  sm_url="$1"
  log ""
  log "Manual registration (curl + token):"
  log "  export SERVICE_MANAGER_URL=\"${sm_url}\""
  log "  export SERVICE_MANAGER_TOKEN=\"<token>\""
  log '  curl -fsS -H "Authorization: Bearer $SERVICE_MANAGER_TOKEN" -H "Content-Type: application/json" \'
  log "    -d '<ServiceSpec JSON>' \"${sm_url%/}/api/v1/services\""
  log ""
  log "Tip: create/update via the service-manager Web UI at: ${sm_url%/}/"
}

main() {
  log "SmallPhone service registration (best-effort)"
  sm_url="$(resolve_sm_url)"
  log "service-manager url: ${sm_url}"
  log "registration token sources: SERVICE_MANAGER_TOKEN, SMALLPHONE_SERVICE_MANAGER_TOKEN, or \`service-manager token show\`"
  log "smallphone-core token sources: SMALLPHONE_SERVICE_MANAGER_TOKEN, SERVICE_MANAGER_TOKEN, or \`service-manager token show\`"
  log ""
  print_intended_services

  if ! have curl; then
    warn "curl not found; cannot call service-manager API"
    print_manual_commands "$sm_url"
    exit 0
  fi

  if ! curl -fsS --max-time 2 "${sm_url%/}/api/v1/health" >/dev/null 2>&1; then
    warn "service-manager is not reachable at: ${sm_url}"
    warn "start it with: service-manager serve --bind 127.0.0.1:20087"
    print_manual_commands "$sm_url"
    exit 0
  fi

  sm_token="$(resolve_sm_token)"
  if [ -z "$sm_token" ]; then
    warn "service-manager token not available; skipping automatic registration"
    if have service-manager; then
      warn "run: service-manager token show"
    fi
    print_manual_commands "$sm_url"
    exit 0
  fi
  core_sm_token="$(resolve_smallphone_sm_token)"
  if [ -z "$core_sm_token" ]; then
    warn "smallphone-core service-manager token not available; using registration token"
    core_sm_token="$sm_token"
  fi

  py=""
  if have python3; then
    py="python3"
  elif have python; then
    py="python"
  fi
  if [ -z "$py" ]; then
    warn "python not found; skipping idempotent registration"
    print_manual_commands "$sm_url"
    exit 0
  fi

  work_dir="$(ensure_work_dir || true)"
  if [ -z "$work_dir" ] || [ ! -d "$work_dir" ]; then
    warn "mktemp not available; skipping service-manager registration to avoid predictable temp files"
    print_manual_commands "$sm_url"
    exit 0
  fi

  curl_cfg="$work_dir/curl.cfg"
  spec_file="$work_dir/service-spec.json"

  cleanup() {
    rm -f "$curl_cfg" "$spec_file" >/dev/null 2>&1 || true
    rmdir "$work_dir" >/dev/null 2>&1 || true
  }
  trap cleanup 0 INT HUP TERM

  write_curl_cfg "$curl_cfg" "$sm_token"

  core_port="${APP_BACKEND_PORT:-${SMALLPHONE_PORT:-22000}}"
  core_host="${APP_BACKEND_HOST:-${SMALLPHONE_HOST:-127.0.0.1}}"
  frontend_port="${FRONTEND_PORT:-22080}"
  frontend_host="${FRONTEND_HOST:-127.0.0.1}"
  beta_port="${BETA_FRONTEND_PORT:-22082}"
  beta_host="${BETA_FRONTEND_HOST:-$frontend_host}"
  backend_port="${BACKEND_PORT:-22096}"
  backend_host="${BACKEND_HOST:-127.0.0.1}"

  upsert_keys="smallphone-core smallphone-frontend smallphone-frontend-beta smallphone-standalone-diary smallphone-standalone-like-girl smallphone-standalone-like-girl-clone smallphone-standalone-album smallphone-like-girl-source"

  # Register the OpenCode backend only when the checkout exists.
  if [ -d "$PARENT_DIR/opencode" ]; then
    upsert_keys="${upsert_keys} smallphone-backend"
  else
    warn "opencode checkout not found at $PARENT_DIR/opencode; skipping smallphone-backend registration"
  fi

  for key in $upsert_keys; do
    case "$key" in
      smallphone-core) name="smallphone-core" ;;
      smallphone-frontend) name="smallphone-frontend" ;;
      smallphone-frontend-beta) name="smallphone-frontend-beta" ;;
      smallphone-backend) name="smallphone-backend" ;;
      smallphone-standalone-diary) name="smallphone-standalone-diary" ;;
      smallphone-standalone-like-girl) name="smallphone-standalone-like-girl" ;;
      smallphone-standalone-like-girl-clone) name="smallphone-standalone-like-girl-clone" ;;
      smallphone-standalone-album) name="smallphone-standalone-album" ;;
      smallphone-like-girl-source) name="smallphone-like-girl-source" ;;
      *) die "unknown key: $key" ;;
    esac

    emit_spec "$py" "$key" \
      "$core_host" "$core_port" \
      "$frontend_host" "$frontend_port" \
      "$beta_host" "$beta_port" \
      "$backend_host" "$backend_port" \
      "$sm_url" \
      "$core_sm_token" >"$spec_file"

    upsert_one "$sm_url" "$curl_cfg" "$py" "$key" "$name" "$spec_file" || true
  done

  log "done"
}

main "$@"
