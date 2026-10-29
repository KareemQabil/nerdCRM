#!/usr/bin/env bash
# Controlled internal staging pilot only: environment comes from a private systemd EnvironmentFile.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${IOETI_STAGING_CONFIG:=/var/lib/ioeti/config/axelor-staging.properties}"
: "${IOETI_APP_PORT:=8080}"
[[ "$IOETI_APP_PORT" =~ ^[0-9]+$ ]] && (( IOETI_APP_PORT > 0 && IOETI_APP_PORT <= 65535 )) || {
  echo "FAIL: invalid IOETI_APP_PORT" >&2; exit 1;
}
python3 "$ROOT/scripts/staging_config.py" --output "$IOETI_STAGING_CONFIG"
[[ -d "$ROOT/axelor-app" ]] || { echo "Missing pinned upstream submodule" >&2; exit 1; }
cd "$ROOT/axelor-app"
# Verified source runner for private staging, NOT yet a rehearsed production packaging strategy.
exec ./gradlew --no-daemon run --port "$IOETI_APP_PORT" --config "$IOETI_STAGING_CONFIG"
