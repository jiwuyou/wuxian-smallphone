#!/bin/sh
set -eu

log() { printf '%s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR=$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
PARENT_DIR=$(cd "$ROOT_DIR/.." >/dev/null 2>&1 && pwd)

SILLYTAVERN_DIR="${SMALLPHONE_SILLYTAVERN_DIR:-${SILLYTAVERN_DIR:-$PARENT_DIR/sillytavern}}"
SILLYTAVERN_SOURCE_DIR="${SMALLPHONE_SILLYTAVERN_SOURCE_DIR:-${SILLYTAVERN_SOURCE_DIR:-}}"
SILLYTAVERN_REPO_URL="${SMALLPHONE_SILLYTAVERN_REPO_URL:-${SILLYTAVERN_REPO_URL:-https://github.com/SillyTavern/SillyTavern.git}}"
SILLYTAVERN_REF="${SMALLPHONE_SILLYTAVERN_REF:-${SILLYTAVERN_REF:-}}"
SILLYTAVERN_DATA_DIR="${SMALLPHONE_SILLYTAVERN_DATA_DIR:-${SILLYTAVERN_DATA_DIR:-$SILLYTAVERN_DIR/data}}"
SKIP_NPM_INSTALL="${SMALLPHONE_SILLYTAVERN_SKIP_NPM_INSTALL:-${SILLYTAVERN_SKIP_NPM_INSTALL:-0}}"
ACTION="${1:-install}"

have() { command -v "$1" >/dev/null 2>&1; }

check_github() {
  have git || die "git is required to check GitHub connectivity."
  log "Checking GitHub connectivity for $SILLYTAVERN_REPO_URL"
  output="$(git ls-remote --heads "$SILLYTAVERN_REPO_URL" 2>&1)" || {
    printf '%s\n' "$output" >&2
    die "GitHub repository is not reachable."
  }
  if printf '%s\n' "$output" | grep -Eq '^[0-9a-fA-F]{40}[[:space:]]+refs/heads/'; then
    log "GitHub reachable."
    return 0
  fi
  die "GitHub reachable check returned no branch refs."
}

copy_source_dir() {
  src="$1"
  dest="$2"
  [ -d "$src" ] || die "source directory not found: $src"
  [ -f "$src/package.json" ] || die "source directory does not look like SillyTavern: $src"
  mkdir -p "$(dirname "$dest")"
  if have rsync; then
    rsync -a --delete --exclude node_modules "$src"/ "$dest"/
  else
    mkdir -p "$dest"
    (cd "$src" && tar --exclude node_modules -cf - .) | (cd "$dest" && tar -xf -)
  fi
}

clone_source() {
  dest="$1"
  have git || die "git is required to clone SillyTavern. Set SMALLPHONE_SILLYTAVERN_SOURCE_DIR to use a local source checkout."
  mkdir -p "$(dirname "$dest")"
  if [ -n "$SILLYTAVERN_REF" ]; then
    git clone --depth 1 --branch "$SILLYTAVERN_REF" "$SILLYTAVERN_REPO_URL" "$dest"
  else
    git clone --depth 1 "$SILLYTAVERN_REPO_URL" "$dest"
  fi
}

ensure_source() {
  if [ -f "$SILLYTAVERN_DIR/package.json" ]; then
    log "SillyTavern source already exists: $SILLYTAVERN_DIR"
    return 0
  fi

  if [ -n "$SILLYTAVERN_SOURCE_DIR" ]; then
    log "Copying SillyTavern source from local directory."
    copy_source_dir "$SILLYTAVERN_SOURCE_DIR" "$SILLYTAVERN_DIR"
    return 0
  fi

  log "Cloning SillyTavern from $SILLYTAVERN_REPO_URL"
  clone_source "$SILLYTAVERN_DIR"
}

ensure_data_dir() {
  mkdir -p "$SILLYTAVERN_DATA_DIR"
  if [ "$SILLYTAVERN_DATA_DIR" = "$SILLYTAVERN_DIR/data" ]; then
    return 0
  fi
  if [ -e "$SILLYTAVERN_DIR/data" ] && [ ! -L "$SILLYTAVERN_DIR/data" ]; then
    log "SillyTavern data directory already exists in checkout; leaving it unchanged."
    return 0
  fi
  rm -f "$SILLYTAVERN_DIR/data"
  ln -s "$SILLYTAVERN_DATA_DIR" "$SILLYTAVERN_DIR/data"
}

install_dependencies() {
  if [ "$SKIP_NPM_INSTALL" = "1" ]; then
    log "Skipping npm install because SMALLPHONE_SILLYTAVERN_SKIP_NPM_INSTALL=1."
    return 0
  fi
  have npm || die "npm is required to install SillyTavern dependencies."
  (cd "$SILLYTAVERN_DIR" && npm install)
}

case "$ACTION" in
  install | "")
    ensure_source
    ensure_data_dir
    install_dependencies
    ;;
  --check-github | check-github | prerequisites)
    check_github
    exit 0
    ;;
  *)
    die "unknown action: $ACTION"
    ;;
esac

log "SillyTavern install ready."
log "dir: $SILLYTAVERN_DIR"
log "data: $SILLYTAVERN_DATA_DIR"
