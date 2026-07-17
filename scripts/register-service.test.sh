#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)
REGISTER="$SCRIPT_DIR/register-service.sh"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/smallphone-register-test.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT INT HUP TERM

SERVICE_MANAGER_TOKEN="must-not-enter-service-spec" \
  "$REGISTER" --print-spec smallphone-core > "$WORK_DIR/core.json"
"$REGISTER" --print-spec smallphone-frontend-beta > "$WORK_DIR/beta.json"
"$REGISTER" --print-spec smallphone-standalone-diary > "$WORK_DIR/diary.json"

python3 - "$WORK_DIR" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
specs = {name: json.loads((root / f"{name}.json").read_text()) for name in ("core", "beta", "diary")}

for name, spec in specs.items():
    assert spec["provider"] == "proot-distro", (name, spec["provider"])
    assert spec["runtime"] == {"distro": "ubuntu", "home": "/root", "user": "root"}
    assert "runtime:ubuntu" in spec["tags"]
    assert "manager:termux-native" in spec["tags"]
    assert spec["command"][:2] == ["sh", "-lc"]
    assert "unset LD_LIBRARY_PATH LD_PRELOAD PREFIX" in spec["command"][2]

core = specs["core"]
serialized = json.dumps(core)
assert "must-not-enter-service-spec" not in serialized
assert "SMALLPHONE_SERVICE_MANAGER_TOKEN" not in serialized
assert "./apps/core/run-managed.js" in core["command"]
assert "SMALLPHONE_COMPONENTS_DIR=/data/data/com.termux/files/home/.config/openhouseai/components.d" in core["command"]
assert "SMALLPHONE_MENU_OVERRIDES_FILE=/data/data/com.termux/files/home/.config/openhouseai/menu-overrides.json" in core["command"]
assert "SMALLPHONE_SERVICE_MANAGER_CONFIG_FILE=/data/data/com.termux/files/home/.config/openhouseai/service-manager/config.json" in core["command"]

assert "scripts/static-server.cjs" in specs["beta"]["command"]
print("register-service tests passed")
PY
