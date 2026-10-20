#!/usr/bin/env python3
"""Strict staging-only Axelor configuration gate and private renderer."""
from __future__ import annotations
import argparse
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "infra/axelor/axelor-config.ioeti.template.properties"
FIELDS = ("IOETI_DB_HOST", "IOETI_DB_PORT", "IOETI_DB_NAME", "IOETI_DB_USER",
          "IOETI_DB_PASSWORD", "IOETI_LOCALE", "IOETI_ENCRYPTION_PASSWORD",
          "IOETI_BANKORDER_ENCRYPTION_PASSWORD", "IOETI_DATA_DIR", "IOETI_LOG_DIR")
OVERRIDES = {"db.default.ddl": "none", "application.mode": "prod",
             "application.description": "IOETI Egypt - controlled internal staging pilot",
             "session.cookie.secure": "true", "ioeti.security.generic-api": "restricted",
             "ioeti.security.maintenance-groups": "admins", "logging.level.com.ioeti": "INFO"}

class StagingError(ValueError):
    pass

def check_environment(env: dict[str, str]) -> None:
    if env.get("IOETI_ENV") != "staging":
        raise StagingError("IOETI_ENV must equal staging")
    if env.get("VITE_IOETI_DEMO", "").lower() in ("true", "1", "yes"):
        raise StagingError("Demo mode must be disabled for authenticated staging")
    origin = urlsplit(env.get("IOETI_STAGING_ORIGIN", ""))
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.path not in ("", "/") or origin.query or origin.fragment):
        raise StagingError("IOETI_STAGING_ORIGIN must be a bare HTTPS origin")
    if origin.hostname.lower() in ("localhost", "127.0.0.1", "0.0.0.0", "example.com", "crm.example.org"):
        raise StagingError("A real staging hostname, not a placeholder, is required")
    missing = [key for key in FIELDS if not env.get(key)]
    if missing:
        raise StagingError("Missing staging variables: " + ", ".join(missing))
    for key in FIELDS:
        if any(char in env[key] for char in "\r\n\0") or "@@" in env[key]:
            raise StagingError("Invalid characters in " + key)
    keys = ("IOETI_DB_PASSWORD", "IOETI_ENCRYPTION_PASSWORD", "IOETI_BANKORDER_ENCRYPTION_PASSWORD")
    for key in keys:
        secret = env[key]
        if (len(secret) < 24 or secret.lower() in ("admin", "password", "change-me", "dev", "test")
                or secret.upper().startswith("REPLACE_") or "PLACEHOLDER" in secret.upper()):
            raise StagingError(key + " requires a non-placeholder unique random 24+ character secret")
    if len({env[key] for key in keys}) != 3:
        raise StagingError("The three secrets must differ")
    if not env["IOETI_DB_PORT"].isdigit() or not 1 <= int(env["IOETI_DB_PORT"]) <= 65535:
        raise StagingError("Invalid database port")
    if env["IOETI_LOCALE"] not in ("ar", "en"):
        raise StagingError("Locale must be ar or en")
    for key in ("IOETI_DATA_DIR", "IOETI_LOG_DIR"):
        if not Path(env[key]).is_absolute():
            raise StagingError(key + " must be an absolute directory")
    if env["IOETI_DATA_DIR"] == env["IOETI_LOG_DIR"]:
        raise StagingError("Attachments and logs cannot share a directory")

def set_property(content: str, key: str, value: str) -> str:
    expression = re.compile(rf"(?m)^\s*#?\s*{re.escape(key)}\s*=.*$")
    matches = list(expression.finditer(content))
    if len(matches) > 1:
        raise StagingError("Duplicate property: " + key)
    if matches:
        return expression.sub(lambda _: key + " = " + value, content)
    return content.rstrip() + "\n" + key + " = " + value + "\n"

def validate_properties(content: str) -> None:
    props: dict[str, str] = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "!")) or "=" not in line:
            continue
        key, value = (s.strip() for s in line.split("=", 1))
        if key in props:
            raise StagingError("Duplicate property: " + key)
        props[key] = value
    for key, expected in OVERRIDES.items():
        if props.get(key) != expected:
            raise StagingError("Unsafe property: " + key)
    for line in content.splitlines():
        if not line.lstrip().startswith(("#", "!")) and "@@" in line:
            raise StagingError("Unresolved placeholders")

def render(template: str, env: dict[str, str]) -> str:
    check_environment(env)
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in FIELDS:
            raise StagingError("Unexpected placeholder: " + key)
        return env[key]
    # Documentation comments may mention @@NAME@@; only active property lines are substituted.
    content = "".join(
        line if line.lstrip().startswith(("#", "!")) else re.sub(r"@@([A-Z0-9_]+)@@", replace, line)
        for line in template.splitlines(keepends=True)
    )
    for line in content.splitlines():
        if not line.lstrip().startswith(("#", "!")) and "@@" in line:
            raise StagingError("Unresolved placeholders")
    for key, value in OVERRIDES.items():
        content = set_property(content, key, value)
    validate_properties(content)
    return content

def save_private(path: Path, content: str) -> None:
    if not path.parent.is_dir():
        raise StagingError("Provision the private config directory first")
    descriptor, temporary = tempfile.mkstemp(prefix=".axelor-staging-", dir=path.parent)
    try:
        os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(temporary, path)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def main() -> int:
    parser = argparse.ArgumentParser(description="Staging config gate")
    parser.add_argument("--template", type=Path, default=TEMPLATE)
    parser.add_argument("--output", type=Path, help="Write a 0600 configuration file (optional)")
    args = parser.parse_args()
    try:
        content = render(args.template.read_text(encoding="utf-8"), dict(os.environ))
        if args.output:
            save_private(args.output, content)
        print("PASS: staging security settings verified; no credentials displayed")
        return 0
    except (OSError, StagingError) as error:
        print("FAIL: " + str(error), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
