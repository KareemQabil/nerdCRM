#!/usr/bin/env python3
"""Encrypted backup and restore drill for the IOETI database (gap G-009).

What a run proves, on the database it is pointed at (local/CI dev container by default):
  1. backup:   pg_dump (custom format) streamed straight into `age` encryption. Plaintext never touches
               disk. The SHA-256 of the ciphertext is recorded, and the file does not contain known
               plaintext.
  2. restore:  decrypt and pg_restore into a NEW, uniquely named database, timed (the restore part of RTO).
  3. verify:   every table's row count, the migration ledger and the IOETI-owned schema are identical,
               and IOETI business-line content matches by checksum.
  4. tamper:   one flipped byte in the ciphertext makes decryption fail (authenticated encryption);
               a wrong key cannot decrypt.
  5. clean-up: the drill database is dropped (only the one this run created) unless --keep-db, which
               leaves it for an application boot test. The backup file is deleted unless --keep.

Keys: `age` X25519. The public recipient encrypts; the private identity is only needed to restore and
belongs off the backup host (production custody, off-site copies, retention, RPO and RTO targets are
policy D-08). The identity defaults to .local/backup-identity.txt (git-ignored), created on first use
for development. Env: IOETI_PG_CONTAINER (default ioeti-dev-postgres), IOETI_BACKUP_IDENTITY. Report:
logs/backup-restore-drill.json.
"""
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db_migrate import CONTAINER, DATABASE, LEDGER, ROOT, USER, psql, snapshot  # noqa: E402

IDENTITY = os.environ.get("IOETI_BACKUP_IDENTITY", os.path.join(ROOT, ".local", "backup-identity.txt"))
BACKUPS = os.path.join(ROOT, ".local", "backups")


def recipient():
    if not os.path.exists(IDENTITY):
        os.makedirs(os.path.dirname(IDENTITY), exist_ok=True)
        subprocess.run(["age-keygen", "-o", IDENTITY], check=True, capture_output=True)
        os.chmod(IDENTITY, 0o600)
    out = subprocess.run(["age-keygen", "-y", IDENTITY], check=True, capture_output=True, text=True)
    return out.stdout.strip()


def table_counts(database):
    tables = psql(database, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;").split()
    sql = " UNION ALL ".join(f"SELECT '{t}', count(*) FROM public.\"{t}\"" for t in tables) + ";"
    return {name: int(n) for name, n in (row.split("|") for row in psql(database, sql).splitlines() if row)}


def content_digest(database):
    rows = psql(database, "SELECT id, code, name_ar, name_en, status_select, version FROM public.ioeti_business_line ORDER BY id;")
    return hashlib.sha256(rows.encode()).hexdigest()


def main(argv):
    keep = "--keep" in argv
    keep_db = "--keep-db" in argv  # leave the restored database for an application boot test
    report = {"source": DATABASE, "checks": [], "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def check(name, ok, detail=""):
        report["checks"].append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail}]"))

    os.makedirs(BACKUPS, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = os.path.join(BACKUPS, f"ioeti-{stamp}.dump.age")
    drill = f"ioeti_restore_drill_{secrets.token_hex(4)}"
    before_counts, before_schema, before_digest = table_counts(DATABASE), snapshot(DATABASE), content_digest(DATABASE)
    before_ledger = psql(DATABASE, f"SELECT version, checksum FROM public.{LEDGER} ORDER BY 1;")
    created_db = False
    try:
        # 1. backup: pg_dump | age, no plaintext on disk
        started = time.monotonic()
        with open(backup, "wb") as out:
            dump = subprocess.Popen(["docker", "exec", CONTAINER, "pg_dump", "-U", USER, "-d", DATABASE, "-Fc"],
                                    stdout=subprocess.PIPE)
            enc = subprocess.run(["age", "-r", recipient()], stdin=dump.stdout, stdout=out)
            dump.stdout.close()
            dump_rc = dump.wait()
        report["backup_seconds"] = round(time.monotonic() - started, 2)
        cipher = open(backup, "rb").read()
        report["backup_bytes"] = len(cipher)
        report["backup_sha256"] = hashlib.sha256(cipher).hexdigest()
        check("backup written and encrypted (pg_dump and age both succeeded)",
              dump_rc == 0 and enc.returncode == 0 and cipher.startswith(b"age-encryption.org/v1"), (dump_rc, enc.returncode))
        check("ciphertext contains no known plaintext", b"ISO9001" not in cipher and b"auth_user" not in cipher)

        # 2. restore into a new database, timed
        psql("postgres", f'CREATE DATABASE "{drill}" OWNER "{USER}";')
        created_db = True
        started = time.monotonic()
        dec = subprocess.Popen(["age", "-d", "-i", IDENTITY, backup], stdout=subprocess.PIPE)
        restore = subprocess.run(["docker", "exec", "-i", CONTAINER, "pg_restore", "-U", USER, "-d", drill,
                                  "--no-owner", "--exit-on-error"], stdin=dec.stdout, capture_output=True, text=True)
        dec.stdout.close()
        dec_rc = dec.wait()
        report["restore_seconds"] = round(time.monotonic() - started, 2)
        check("decrypt and restore succeeded", dec_rc == 0 and restore.returncode == 0, restore.stderr[:300])

        # 3. verify
        after_counts = table_counts(drill)
        diff = {t: (before_counts.get(t), after_counts.get(t)) for t in set(before_counts) | set(after_counts)
                if before_counts.get(t) != after_counts.get(t)}
        report["tables"], report["rows"] = len(after_counts), sum(after_counts.values())
        check(f"every table restored with identical row counts ({len(after_counts)} tables)", not diff,
              dict(list(diff.items())[:10]))
        check("IOETI-owned schema identical", snapshot(drill) == before_schema)
        check("migration ledger identical",
              psql(drill, f"SELECT version, checksum FROM public.{LEDGER} ORDER BY 1;") == before_ledger)
        check("IOETI business-line content identical (checksum)", content_digest(drill) == before_digest)

        # 4. tamper and wrong-key checks
        with tempfile.TemporaryDirectory() as tmp:
            tampered = os.path.join(tmp, "tampered.age")
            data = bytearray(cipher)
            data[len(data) // 2] ^= 0x01
            open(tampered, "wb").write(data)
            bad = subprocess.run(["age", "-d", "-i", IDENTITY, tampered], capture_output=True)
            check("one flipped byte makes decryption fail", bad.returncode != 0)
            other = os.path.join(tmp, "other.txt")
            subprocess.run(["age-keygen", "-o", other], check=True, capture_output=True)
            wrong = subprocess.run(["age", "-d", "-i", other, backup], capture_output=True)
            check("a different key cannot decrypt", wrong.returncode != 0)
    finally:
        if created_db and not keep_db:
            psql("postgres", f'DROP DATABASE IF EXISTS "{drill}";')
        if not keep and os.path.exists(backup):
            os.remove(backup)
    left = psql("postgres", f"SELECT count(*) FROM pg_database WHERE datname = '{drill}';").strip()
    if keep_db:
        report["restored_database"] = drill
        print(f"RESTORED_DATABASE={drill}  (kept for a boot test; drop it afterwards)")
    else:
        check("drill database removed", left == "0", left)
    failed = [c for c in report["checks"] if c["result"] != "PASS"]
    print(f"\n{len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed · backup "
          f"{report.get('backup_bytes', 0) / 1e6:.1f} MB in {report.get('backup_seconds')} s · restore "
          f"{report.get('restore_seconds')} s")
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "backup-restore-drill.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
