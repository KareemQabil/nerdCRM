#!/usr/bin/env python3
"""Versioned migrations for the IOETI-owned database schema (gap G-008).

Axelor creates and alters tables at start-up from the domain XML (`db.default.ddl = update`). That is
convenient in development but is not a reviewed, repeatable production change. IOETI therefore keeps
every IOETI-owned object (tables `ioeti_*`, columns `ioeti_*` on upstream tables, their constraints,
indexes and sequences) in ordered, idempotent SQL files under db/migrations, with a rollback for each.

Usage (local/CI, against the dev container; never against production without a backup and approval):
  python3 scripts/db_migrate.py status            applied versions and pending files
  python3 scripts/db_migrate.py apply             apply pending migrations, one transaction each
  python3 scripts/db_migrate.py verify            prove the chain on a schema-only scratch copy:
        rollback removes every IOETI object · forward run reproduces the schema Hibernate generated
        exactly · running it twice changes nothing · no IOETI object exists outside the migrations
Applied files are immutable: a changed checksum fails `apply` and `verify`.
Env: IOETI_PG_CONTAINER (default ioeti-dev-postgres); database and user from .env. Report:
logs/migration-verify.json.
"""
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS = os.path.join(ROOT, "db", "migrations")
CONTAINER = os.environ.get("IOETI_PG_CONTAINER", "ioeti-dev-postgres")
LEDGER = "ioeti_schema_migration"
FORWARD = re.compile(r"^V(\d{3})__([a-z0-9_]+)\.sql$")


def env():
    values = {}
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.strip().split("=", 1)
            values[key] = value
    return values


ENV = env()
USER, DATABASE = ENV["IOETI_DB_USER"], ENV["IOETI_DB_NAME"]


def psql(database, sql=None, path=None, single_transaction=False):
    """Runs SQL inside the PostgreSQL container (client and server versions always match)."""
    args = ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
            "-U", USER, "-d", database]
    if single_transaction:
        args.append("--single-transaction")
    data = sql if sql is not None else open(path, encoding="utf-8").read()
    out = subprocess.run(args, input=data, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql failed on {database}: {out.stderr.strip()[:400]}")
    return out.stdout


def migrations():
    found = []
    for name in sorted(os.listdir(MIGRATIONS)):
        match = FORWARD.match(name)
        if match:
            path = os.path.join(MIGRATIONS, name)
            rollback = os.path.join(MIGRATIONS, "rollback", "U" + name[1:])
            if not os.path.exists(rollback):
                raise SystemExit(f"{name} has no rollback file {os.path.relpath(rollback, ROOT)}")
            found.append({"version": int(match.group(1)), "name": name, "path": path, "rollback": rollback,
                          "checksum": hashlib.sha256(open(path, "rb").read()).hexdigest()})
    versions = [m["version"] for m in found]
    if versions != list(range(1, len(found) + 1)):
        raise SystemExit(f"migration versions must be contiguous from V001: {versions}")
    return found


def ensure_ledger(database):
    psql(database, f"""CREATE TABLE IF NOT EXISTS public.{LEDGER} (
        version integer PRIMARY KEY, name text NOT NULL, checksum char(64) NOT NULL,
        applied_on timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL DEFAULT current_user);""")


def applied(database):
    ensure_ledger(database)
    rows = psql(database, f"SELECT version, name, checksum FROM public.{LEDGER} ORDER BY version;")
    return {int(v): (n, c) for v, n, c in (line.split("|") for line in rows.splitlines() if line)}


def apply(database):
    done = applied(database)
    ran = []
    for m in migrations():
        if m["version"] in done:
            if done[m["version"]][1] != m["checksum"]:
                raise SystemExit(f"{m['name']} was changed after it was applied (checksum mismatch); "
                                 "add a new migration instead of editing an applied one")
            continue
        sql = open(m["path"], encoding="utf-8").read() + (
            f"\nINSERT INTO public.{LEDGER}(version, name, checksum) "
            f"VALUES ({m['version']}, '{m['name']}', '{m['checksum']}');\n")
        psql(database, sql, single_transaction=True)
        ran.append(m["name"])
    return ran


SNAPSHOT_SQL = f"""
SELECT 'column ' || c.table_name || '.' || c.column_name || ' ' || c.data_type
       || coalesce('(' || c.character_maximum_length || ')', '') || ' null=' || c.is_nullable
       || ' default=' || coalesce(c.column_default, '-')
  FROM information_schema.columns c
 WHERE c.table_schema = 'public' AND c.table_name <> '{LEDGER}'
   AND (c.table_name LIKE 'ioeti\\_%' OR c.column_name LIKE 'ioeti\\_%')
UNION ALL
SELECT 'constraint ' || con.conrelid::regclass || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = 'public' AND con.conrelid::regclass::text <> '{LEDGER}'
   AND (con.conrelid::regclass::text LIKE 'ioeti\\_%' OR pg_get_constraintdef(con.oid) ~ '\\mioeti_')
UNION ALL
SELECT 'index ' || indexname || ' ' || indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename <> '{LEDGER}'
   AND (tablename LIKE 'ioeti\\_%' OR indexdef ~ '\\(ioeti_') AND indexname NOT LIKE '%\\_pkey'
UNION ALL
SELECT 'sequence ' || sequence_name FROM information_schema.sequences
 WHERE sequence_schema = 'public' AND sequence_name LIKE 'ioeti\\_%'
ORDER BY 1;
"""


def snapshot(database):
    return [line for line in psql(database, SNAPSHOT_SQL).splitlines() if line]


def verify():
    report = {"source": DATABASE, "checks": [], "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def check(name, ok, detail=""):
        report["checks"].append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail}]"))
        return ok

    chain = migrations()
    done = applied(DATABASE)
    check("applied migrations are unchanged (checksums)",
          all(done[m["version"]][1] == m["checksum"] for m in chain if m["version"] in done),
          {m["name"] for m in chain if m["version"] in done and done[m["version"]][1] != m["checksum"]})
    expected = snapshot(DATABASE)
    check("source has IOETI-owned objects to compare", len(expected) > 0, len(expected))
    scratch = f"ioeti_migration_verify_{secrets.token_hex(4)}"
    psql("postgres", f'CREATE DATABASE "{scratch}" OWNER "{USER}";')
    try:
        # schema only: no business or personal data leaves the source database
        dump = subprocess.run(["docker", "exec", CONTAINER, "pg_dump", "-U", USER, "-d", DATABASE,
                               "--schema-only", "--no-owner", "--no-privileges"], capture_output=True, text=True)
        if dump.returncode != 0:
            raise RuntimeError(dump.stderr[:400])
        psql(scratch, re.sub(r"^\\(un)?restrict .*$", "", dump.stdout, flags=re.M))
        check("scratch copy has the same IOETI objects as the source", snapshot(scratch) == expected)
        # negative control on the scratch copy only: an IOETI column no migration knows about
        psql(scratch, "ALTER TABLE public.crm_lead ADD COLUMN ioeti_drift_probe integer;")
        for m in reversed(chain):
            psql(scratch, path=m["rollback"], single_transaction=True)
        check("drift guard detects an IOETI object that no migration covers (negative control)",
              snapshot(scratch) == ["column crm_lead.ioeti_drift_probe integer null=YES default=-"], snapshot(scratch))
        psql(scratch, "ALTER TABLE public.crm_lead DROP COLUMN ioeti_drift_probe;")
        # whatever the rollback chain leaves behind was created outside the migrations (Hibernate drift)
        check("every IOETI-owned object is covered by a migration (rollback chain leaves nothing)",
              snapshot(scratch) == [], {"not_covered": snapshot(scratch)[:10]})
        for m in chain:
            psql(scratch, path=m["path"], single_transaction=True)
        actual = snapshot(scratch)
        missing, extra = sorted(set(expected) - set(actual)), sorted(set(actual) - set(expected))
        check("forward chain reproduces the Hibernate-generated schema exactly", not missing and not extra,
              {"missing_from_migrations": missing[:10], "not_in_source": extra[:10]})
        for m in chain:
            psql(scratch, path=m["path"], single_transaction=True)
        check("forward chain is idempotent (second run changes nothing)", snapshot(scratch) == actual)
        ensure_ledger(scratch)
        psql(scratch, f"TRUNCATE public.{LEDGER};")
        ran = apply(scratch)
        check("runner applies the full chain once and records it", ran == [m["name"] for m in chain]
              and apply(scratch) == [], ran)
    finally:
        psql("postgres", f'DROP DATABASE IF EXISTS "{scratch}";')
    report["migrations"] = [m["name"] for m in chain]
    failed = [c for c in report["checks"] if c["result"] != "PASS"]
    print(f"\n{len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed")
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "migration-verify.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=list)
    return 0 if not failed else 1


def main(argv):
    command = argv[1] if len(argv) > 1 else "status"
    if command == "status":
        done = applied(DATABASE)
        for m in migrations():
            print(("applied " if m["version"] in done else "pending ") + m["name"])
        return 0
    if command == "apply":
        ran = apply(DATABASE)
        print("applied: " + (", ".join(ran) if ran else "nothing pending"))
        return 0
    if command == "verify":
        return verify()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
