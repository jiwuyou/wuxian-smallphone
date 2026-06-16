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

SKIP_INSTALL=0
if [ "${SMALLPHONE_SKIP_DEP_INSTALL:-0}" = "1" ]; then
  SKIP_INSTALL=1
fi

require_cmd() {
  cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die "Missing required command: $cmd"
  fi
}

has_deps() {
  dir="$1"
  [ -f "$dir/package.json" ] || return 1
  # Print 1 if any deps are declared; 0 otherwise.
  has="$(node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const keys = ["dependencies","devDependencies","optionalDependencies","peerDependencies"];
    const ok = keys.some((k) => p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0);
    process.stdout.write(ok ? "1" : "0");
  ' "$dir/package.json")"
  [ "$has" = "1" ]
}

missing_installed_deps() {
  dir="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const packageJson = process.argv[1];
    const dir = process.argv[2];
    const p = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    const keys = ["dependencies","devDependencies","optionalDependencies","peerDependencies"];
    const names = [...new Set(keys.flatMap((k) => {
      const deps = p[k];
      return deps && typeof deps === "object" ? Object.keys(deps) : [];
    }))];
    const missing = names.filter((name) => {
      const depPath = path.join(dir, "node_modules", ...name.split("/"));
      return !fs.existsSync(depPath);
    });
    process.stdout.write(missing.join(", "));
  ' "$dir/package.json" "$dir"
}

preferred_pm() {
  dir="$1"
  [ -f "$dir/package.json" ] || return 0
  pm="$(node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = String(p.packageManager || "");
    if (value.startsWith("pnpm@") || value === "pnpm") process.stdout.write("pnpm");
    else if (value.startsWith("npm@") || value === "npm") process.stdout.write("npm");
  ' "$dir/package.json")"
  printf '%s' "$pm"
}

install_one() {
  dir="$1"

  if [ ! -d "$dir" ]; then
    warn "Skipping missing directory: $dir"
    return 0
  fi

  if [ ! -f "$dir/package.json" ]; then
    log "skip: $(basename "$dir") (no package.json)"
    return 0
  fi

  if ! has_deps "$dir"; then
    log "skip: $(basename "$dir") (no dependencies declared)"
    return 0
  fi

  pm="$(preferred_pm "$dir")"

  if [ "$SKIP_INSTALL" = "1" ]; then
    missing="$(missing_installed_deps "$dir")"
    if [ -n "$missing" ]; then
      die "Dependency installation is explicitly skipped for $(basename "$dir"), but installed dependencies are missing: $missing. Install dependencies first or include node_modules in the payload."
    fi
    log "skip: $(basename "$dir") (dependencies already installed; ${pm:-npm} install disabled)"
    return 0
  fi

  if [ "$pm" = "pnpm" ]; then
    if command -v pnpm >/dev/null 2>&1; then
      if [ -f "$dir/pnpm-lock.yaml" ]; then
        log "install: $(basename "$dir") (pnpm --frozen-lockfile)"
        (cd "$dir" && pnpm install --frozen-lockfile)
      else
        log "install: $(basename "$dir") (pnpm)"
        (cd "$dir" && pnpm install)
      fi
      return 0
    fi
    warn "packageManager is pnpm but pnpm is not available; falling back to npm install"
  fi

  require_cmd npm
  log "install: $(basename "$dir") (npm)"
  (cd "$dir" && npm install)
}

main() {
  if [ "$SKIP_INSTALL" = "1" ]; then
    log "Dependency installation is explicitly skipped; verifying installed dependencies."
  fi

  require_cmd node

  install_one "$ROOT_DIR/smallphone-app"

  if [ -d "$ROOT_DIR/standalone-apps" ]; then
    for d in "$ROOT_DIR/standalone-apps"/*; do
      [ -d "$d" ] || continue
      install_one "$d"
    done
  fi

  log "done"
}

main "$@"
