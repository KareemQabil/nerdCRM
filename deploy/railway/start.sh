#!/usr/bin/env bash
# Railway entrypoint: render the Axelor configuration from the service variables, start Tomcat and Caddy,
# then run the one-time bootstrap in the background. Refuses to start without the required secrets.
set -euo pipefail
ROOT="${IOETI_ROOT:-/opt/ioeti}"
fail() { echo "FAIL: $*" >&2; exit 1; }

# Railway's PostgreSQL plugin provides PG* variables (or DATABASE_URL); IOETI_DB_* take precedence.
if [[ -z "${PGHOST:-}" && -n "${DATABASE_URL:-}" ]]; then
  eval "$(python3 - <<'PY'
import os, shlex
from urllib.parse import urlsplit, unquote
u = urlsplit(os.environ["DATABASE_URL"])
for k, v in (("PGHOST", u.hostname), ("PGPORT", u.port or 5432), ("PGUSER", unquote(u.username or "")),
             ("PGPASSWORD", unquote(u.password or "")), ("PGDATABASE", u.path.lstrip("/"))):
    print(f"export {k}={shlex.quote(str(v))}")
PY
)"
fi
export IOETI_DB_HOST="${IOETI_DB_HOST:-${PGHOST:-}}" IOETI_DB_PORT="${IOETI_DB_PORT:-${PGPORT:-5432}}"
export IOETI_DB_NAME="${IOETI_DB_NAME:-${PGDATABASE:-}}" IOETI_DB_USER="${IOETI_DB_USER:-${PGUSER:-}}"
export IOETI_DB_PASSWORD="${IOETI_DB_PASSWORD:-${PGPASSWORD:-}}"
export IOETI_LOCALE="${IOETI_LOCALE:-ar}" IOETI_DATA_DIR="${IOETI_DATA_DIR:-/data}" IOETI_LOG_DIR="${IOETI_LOG_DIR:-/data/logs}"
for v in IOETI_DB_HOST IOETI_DB_NAME IOETI_DB_USER IOETI_DB_PASSWORD IOETI_ENCRYPTION_PASSWORD \
         IOETI_BANKORDER_ENCRYPTION_PASSWORD IOETI_ADMIN_PASSWORD; do
  [[ -n "${!v:-}" ]] || fail "missing service variable $v (see docs/runbooks/RAILWAY_STAGING.md)"
done
(( ${#IOETI_ADMIN_PASSWORD} >= 12 )) || fail "IOETI_ADMIN_PASSWORD must have at least 12 characters"
[[ "${VITE_IOETI_DEMO:-}" != "true" ]] || fail "demo mode is not allowed on an authenticated deployment"

mkdir -p "$IOETI_DATA_DIR/attachments" "$IOETI_DATA_DIR/tmp" "$IOETI_DATA_DIR/reports" "$IOETI_LOG_DIR" "$IOETI_DATA_DIR/state"
# private state (rendered config, showcase state) lives on the volume, never in the image
rm -rf "$ROOT/.local" && ln -s "$IOETI_DATA_DIR/state" "$ROOT/.local"
CONFIG="$ROOT/.local/axelor-config.properties"
tmp="$(cat "$ROOT/infra/axelor/axelor-config.ioeti.template.properties")"
for v in IOETI_DB_HOST IOETI_DB_PORT IOETI_DB_NAME IOETI_DB_USER IOETI_DB_PASSWORD IOETI_LOCALE \
         IOETI_ENCRYPTION_PASSWORD IOETI_BANKORDER_ENCRYPTION_PASSWORD IOETI_DATA_DIR IOETI_LOG_DIR; do
  tmp="${tmp//@@$v@@/${!v}}"
done
{
  printf '%s\n' "$tmp"
  # staging overrides (later keys win): HTTPS-only cookies, production mode, quieter logs, Caddy is trusted
  printf '%s\n' "application.mode = prod" "application.description = IOETI Egypt - staging on Railway" \
    "session.cookie.secure = true" "logging.level.com.ioeti = INFO" "ioeti.security.trusted.proxies = 127.0.0.1"
} > "$CONFIG"
chmod 600 "$CONFIG"

export CATALINA_OPTS="${CATALINA_OPTS:-} -Daxelor.config=$CONFIG -Xms512m -Xmx${IOETI_JAVA_HEAP:-1536m} -Dfile.encoding=UTF-8"
"$CATALINA_HOME/bin/catalina.sh" run &
tomcat=$!
caddy run --config "$ROOT/deploy/railway/Caddyfile" --adapter caddyfile &
proxy=$!
trap 'kill "$tomcat" "$proxy" 2>/dev/null || true' TERM INT
# first boot: replace the default admin password, install the apps, optionally seed the fictional showcase
IOETI_JAR_DIR="$CATALINA_HOME/webapps/axelor-erp/WEB-INF/lib" python3 "$ROOT/deploy/railway/bootstrap.py" &
wait -n "$tomcat" "$proxy"
exit 1
