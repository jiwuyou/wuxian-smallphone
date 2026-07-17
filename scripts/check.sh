#!/bin/sh
set -eu

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR=$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

require_cmd() {
  cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die "Missing required command: $cmd"
  fi
}

node_major_version() {
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0] || ""))'
}

required_node_major_for_dir() {
  dir="$1"
  [ -f "$dir/package.json" ] || return 0
  node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const raw = String((p.engines && p.engines.node) || "").trim();
    const m = raw.match(/^>=\s*(\d+)\b/);
    process.stdout.write(m ? String(Number(m[1] || 0)) : "0");
  ' "$dir/package.json"
}

has_deps() {
  dir="$1"
  [ -f "$dir/package.json" ] || return 1
  has="$(node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const keys = ["dependencies","devDependencies","optionalDependencies","peerDependencies"];
    const ok = keys.some((k) => p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0);
    process.stdout.write(ok ? "1" : "0");
  ' "$dir/package.json")"
  [ "$has" = "1" ]
}

inspect_deps_dir() {
  dir="$1"

  if [ ! -d "$dir" ]; then
    log "skip: $dir (missing directory)"
    return 0
  fi

  if [ ! -f "$dir/package.json" ]; then
    log "skip: $(basename "$dir") (no package.json)"
    return 0
  fi

  if ! has_deps "$dir"; then
    log "ok: $(basename "$dir") (no dependencies declared)"
    return 0
  fi

  if [ -d "$dir/node_modules" ]; then
    log "ok: $(basename "$dir") (node_modules present)"
    return 0
  fi

  printf 'ERROR: %s is missing node_modules. Run scripts/install.sh\n' "$dir" >&2
  MISSING_DEPS=1
  return 0
}

run_pkg_check() {
  dir="$1"
  label="$2"

  if [ ! -f "$dir/package.json" ]; then
    log "skip: $label (no package.json)"
    return 0
  fi

  # If deps exist, require node_modules.
  if has_deps "$dir" && [ ! -d "$dir/node_modules" ]; then
    MISSING_DEPS=1
    printf 'ERROR: %s deps are missing; cannot run check. Run scripts/install.sh\n' "$label" >&2
    return 0
  fi

  if node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(p.scripts && p.scripts.check ? "1" : "0");
  ' "$dir/package.json" | grep -q "^1$"; then
    require_cmd npm
    log "run: $label npm run check"
    (cd "$dir" && npm run check)
  else
    warn "$label has no check script; skipping"
  fi
}

main() {
  require_cmd node

  major="$(node_major_version)"
  case "$major" in
    ''|*[!0-9]*)
      die "Unable to determine Node version from: $(node -v 2>/dev/null || printf 'unknown')"
      ;;
  esac
  if [ "$major" -lt 20 ]; then
    die "Node >= 20 is required. Found: $(node -v)"
  fi
  log "ok: node $(node -v)"

  # Enforce per-package engine requirements (standalone apps may require >=22).
  ENGINE_FAIL=0

  for dir in "$ROOT_DIR/smallphone-app" "$ROOT_DIR/standalone-apps"/*; do
    [ -d "$dir" ] || continue
    [ -f "$dir/package.json" ] || continue

    req="$(required_node_major_for_dir "$dir")"
    case "$req" in
      ''|*[!0-9]*)
        req="0"
        ;;
    esac

    if [ "$req" -gt 0 ] && [ "$major" -lt "$req" ]; then
      printf 'ERROR: %s requires Node %s (found %s)\n' "$dir" "$req" "$(node -v)" >&2
      ENGINE_FAIL=1
    fi
  done

  MISSING_DEPS=0

  inspect_deps_dir "$ROOT_DIR/smallphone-app"

  if [ -d "$ROOT_DIR/standalone-apps" ]; then
    for d in "$ROOT_DIR/standalone-apps"/*; do
      [ -d "$d" ] || continue
      inspect_deps_dir "$d"
    done
  fi

  run_pkg_check "$ROOT_DIR/smallphone-app" "smallphone-app"

  if [ -d "$ROOT_DIR/standalone-apps" ]; then
    for d in "$ROOT_DIR/standalone-apps"/*; do
      [ -d "$d" ] || continue
      run_pkg_check "$d" "standalone:$(basename "$d")"
    done
  fi

  if [ "$ENGINE_FAIL" -ne 0 ]; then
    exit 1
  fi

  if [ "$MISSING_DEPS" -ne 0 ]; then
    exit 2
  fi

  log "run: register-service spec tests"
  "$SCRIPT_DIR/register-service.test.sh"

  log "done"
}

main "$@"
