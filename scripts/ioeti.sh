#!/usr/bin/env bash
# IOETI developer command dispatcher (Linux / macOS / WSL2).
# Usage: scripts/ioeti.sh <command>
#   init        create .env with generated secrets (if missing), render Axelor config, link IOETI modules
#   db-up       start PostgreSQL 16 (docker compose) and wait until healthy
#   db-down     stop PostgreSQL (data volume is kept)
#   build       compile the whole application (upstream + IOETI modules), skip tests
#   test        run IOETI module tests
#   run         start Axelor on http://localhost:$IOETI_APP_PORT (foreground)
#   health      check that the running application answers and login works
#   install-apps  install the AOS apps IOETI reuses (base, crm, sale, contract, project, ...)
#   restore-meta  reload views/selections/translations of installed modules (after XML/i18n edits)
#   smoke       run the API end-to-end + negative permission checks (needs running app)
#   ui          run the browser checks with Playwright (needs running app)
#   probes      security probes: record-filter leak (after restore-meta) + field-rule enforcement
#   reset-db    DESTROY the IOETI dev database volume (asks for confirmation; touches nothing else)
#   status      show versions, submodule pins, container status
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/axelor-app"
COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker-compose.yml")
IOETI_MODULES=(ioeti-core ioeti-business-lines)

load_env() {
  [[ -f "$ROOT/.env" ]] || { echo "Missing .env - run: scripts/ioeti.sh init" >&2; exit 1; }
  set -a; # shellcheck disable=SC1091
  source "$ROOT/.env"; set +a
  case "$IOETI_DATA_DIR" in /*) ;; *) IOETI_DATA_DIR="$ROOT/$IOETI_DATA_DIR" ;; esac
  IOETI_LOG_DIR="$ROOT/logs"
  export IOETI_DATA_DIR IOETI_LOG_DIR
}

gen_secret() { openssl rand -base64 24 | tr -d '/+=' | cut -c1-24; }

render_config() {
  load_env
  mkdir -p "$ROOT/.local" "$IOETI_DATA_DIR/attachments" "$IOETI_DATA_DIR/tmp" "$IOETI_DATA_DIR/reports" "$IOETI_LOG_DIR"
  local out="$ROOT/.local/axelor-config.local.properties" tmp
  tmp="$(cat "$ROOT/infra/axelor/axelor-config.ioeti.template.properties")"
  for v in IOETI_DB_HOST IOETI_DB_PORT IOETI_DB_NAME IOETI_DB_USER IOETI_DB_PASSWORD IOETI_LOCALE \
           IOETI_ENCRYPTION_PASSWORD IOETI_BANKORDER_ENCRYPTION_PASSWORD IOETI_DATA_DIR IOETI_LOG_DIR; do
    tmp="${tmp//@@$v@@/${!v}}"
  done
  printf '%s\n' "$tmp" > "$out"
  chmod 600 "$out"
  echo "Rendered $out"
}

link_modules() {
  # IOETI modules live in $ROOT/modules (IOETI repository). Axelor's settings.gradle auto-includes every
  # directory under axelor-app/modules that has a build.gradle, so we expose ours through symlinks and keep
  # the upstream working tree clean (links are excluded locally via .git/info/exclude).
  local exclude="$APP/.git/info/exclude"
  [[ -f "$APP/.git" ]] && exclude="$(git -C "$APP" rev-parse --git-path info/exclude)"
  mkdir -p "$(dirname "$exclude")"; touch "$exclude"
  for m in "${IOETI_MODULES[@]}"; do
    if [[ ! -e "$APP/modules/$m" && ! -L "$APP/modules/$m" ]]; then ln -s "../../modules/$m" "$APP/modules/$m"; fi
    grep -qx "/modules/$m" "$exclude" || echo "/modules/$m" >> "$exclude"
  done
  echo "Linked IOETI modules: ${IOETI_MODULES[*]}"
}

cmd_init() {
  if [[ ! -f "$ROOT/.env" ]]; then
    sed -e "s/^IOETI_DB_PASSWORD=.*/IOETI_DB_PASSWORD=$(gen_secret)/" \
        -e "s/^IOETI_ENCRYPTION_PASSWORD=.*/IOETI_ENCRYPTION_PASSWORD=$(gen_secret)/" \
        -e "s/^IOETI_BANKORDER_ENCRYPTION_PASSWORD=.*/IOETI_BANKORDER_ENCRYPTION_PASSWORD=$(gen_secret)/" \
        "$ROOT/.env.example" > "$ROOT/.env"
    chmod 600 "$ROOT/.env"
    echo "Created .env with generated secrets"
  fi
  # Upstream .gitmodules uses an SSH URL for axelor-open-suite; override it locally with HTTPS
  # (local git config only, the pinned commit is unchanged).
  git -C "$ROOT" submodule update --init axelor-app
  git -C "$APP" submodule init
  git -C "$APP" config submodule.axelor-open-suite.url https://github.com/axelor/axelor-open-suite.git
  git -C "$APP" submodule update
  render_config
  link_modules
}

cmd_db_up() {
  load_env
  "${COMPOSE[@]}" up -d postgres
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' ioeti-dev-postgres 2>/dev/null)" == healthy ]] && { echo "PostgreSQL healthy on 127.0.0.1:$IOETI_DB_PORT"; return; }
    sleep 2
  done
  echo "PostgreSQL did not become healthy" >&2; exit 1
}

cmd_db_down() { load_env; "${COMPOSE[@]}" stop postgres; }

cmd_build() { (cd "$APP" && ./gradlew --max-workers=2 assemble -x archiveReports "$@"); }

cmd_test() {
  local tasks=()
  for m in "${IOETI_MODULES[@]}"; do tasks+=(":modules:$m:test"); done
  (cd "$APP" && ./gradlew --max-workers=2 "${tasks[@]}" "$@")
}

cmd_run() {
  load_env; render_config; link_modules
  (cd "$APP" && ./gradlew run --port "$IOETI_APP_PORT" --config "$ROOT/.local/axelor-config.local.properties" "$@")
}

cmd_health() {
  load_env
  # `gradlew run` serves the app under the Gradle project name: /axelor-erp
  local base="http://localhost:$IOETI_APP_PORT/axelor-erp" code jar
  code="$(curl -s -o /dev/null -w '%{http_code}' "$base/")"
  echo "GET / -> $code"
  jar="$(mktemp)"
  code="$(curl -s -c "$jar" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
          -d "{\"username\":\"${IOETI_HEALTH_USER:-admin}\",\"password\":\"${IOETI_HEALTH_PASSWORD:-admin}\"}" "$base/callback")"
  echo "POST /callback (login) -> $code"
  code="$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
          -d '{"limit":1,"fields":["code"]}' "$base/ws/rest/com.axelor.auth.db.User/search")"
  echo "POST /ws/rest/.../User/search (authenticated) -> $code"
  rm -f "$jar"
  [[ "$code" == 200 ]]
}

cmd_restore_meta() {
  python3 - <<'PY'
import os, sys
sys.path.insert(0, os.path.join(os.environ["ROOT"], "scripts"))
from api_smoke_test import Client
c = Client()
assert c.login(os.environ.get("IOETI_ADMIN_USER", "admin"), os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) == 200
_, r = c.call("POST", "/ws/action", {"action": "com.axelor.meta.web.MetaController:restoreAll",
                                     "model": "com.axelor.meta.db.MetaView", "data": {"context": {}}})
print(r)
sys.exit(0 if r.get("status") == 0 else 1)
PY
}

cmd_reset_db() {
  load_env
  echo "This deletes ONLY the container ioeti-dev-postgres and the volume ioeti_dev_pgdata."
  read -r -p "Type 'reset ioeti_dev' to continue: " answer
  [[ "$answer" == "reset ioeti_dev" ]] || { echo "Aborted."; exit 1; }
  "${COMPOSE[@]}" down
  docker volume rm ioeti_dev_pgdata
  echo "Dev database removed. Run scripts/ioeti.sh db-up to recreate it."
}

cmd_status() {
  echo "IOETI repo:      $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "open-suite-webapp: $(git -C "$APP" describe --tags --always) ($(git -C "$APP" rev-parse HEAD))"
  git -C "$APP" submodule status --recursive
  java -version 2>&1 | grep -v JAVA_TOOL | head -1
  docker ps --filter name=ioeti-dev-postgres --format '{{.Names}} {{.Status}}'
}

case "${1:-}" in
  init) cmd_init ;;
  db-up) cmd_db_up ;;
  db-down) cmd_db_down ;;
  build) shift; cmd_build "$@" ;;
  test) shift; cmd_test "$@" ;;
  run) shift; cmd_run "$@" ;;
  health) cmd_health ;;
  install-apps) shift; python3 "$ROOT/scripts/install_apps.py" "$@" ;;
  restore-meta) ROOT="$ROOT" cmd_restore_meta ;;
  smoke) python3 "$ROOT/scripts/api_smoke_test.py" ;;
  ui) NODE_PATH="$(npm root -g)" node "$ROOT/scripts/ui_smoke_test.cjs" ;;
  probes) python3 "$ROOT/scripts/record_filter_leak_probe.py" && python3 "$ROOT/scripts/field_permission_probe.py" ;;
  reset-db) cmd_reset_db ;;
  status) cmd_status ;;
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
