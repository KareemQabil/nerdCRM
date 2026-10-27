# Runbook: IOETI database migrations, backup and restore

Gaps: **G-008** (migration path) and **G-009** (recovery).

Status: the engineering mechanism is verified live, locally and in backend CI. **Production targets are policy D-08** and are not set here: RPO, RTO, off-site copies, retention, key custody and the operator on call.

## 1. Versioned migrations (`db/migrations`, `scripts/db_migrate.py`)

**What is covered.** Every IOETI-owned database object:
- tables `ioeti_*`;
- `ioeti_*` columns on upstream tables;
- their constraints, indexes and sequences.

Each `V###__name.sql` has a rollback `rollback/U###__name.sql`. Migrations are idempotent, so they are safe on a database where Hibernate already created the objects.

**Ledger.** `public.ioeti_schema_migration` records version, file name, SHA-256, time and database user. An applied file is immutable: an edited one fails `apply` and `verify`. Fix mistakes with a new migration.

**`python3 scripts/db_migrate.py verify`** works on a **schema-only** scratch copy, so no business or personal data is copied. It proves that:
1. the scratch copy matches the source;
2. a planted uncovered `ioeti_*` column is detected (negative control);
3. the rollback chain removes every IOETI object, so nothing exists outside the migrations;
4. the forward chain reproduces exactly the schema Hibernate generated from the domain XML;
5. a second forward run changes nothing;
6. the runner applies the chain once and records it.

The scratch database is always dropped.

**CI gate.** A PR that adds an IOETI table or column to a domain XML without a matching migration fails backend CI. AGENTS.md states the same rule for contributors.

**Upstream schema.** Axelor and AOS tables are still created and upgraded by Axelor (`db.default.ddl = update`). The upgrade procedure below runs that step on a restored staging copy first, never directly on production.

### Upgrade or deployment procedure (staging first)
1. Run the backup drill (section 2) on production and keep the encrypted file.
2. Restore that backup into staging.
3. Start the new build on staging, so Axelor updates the upstream schema there.
4. Run `db_migrate.py apply` and then `verify` on staging.
5. Run the full probe suite against staging, then UAT.
6. Repeat on production in a maintenance window.

**Rollback.**
- Restore the step 1 backup. This is the only rollback that also restores data.
- `U###` files undo IOETI schema changes and **delete the data in those columns**. Use them only after a backup and with owner approval.

## 2. Encrypted backup and restore drill (`scripts/backup_restore_drill.py`)

**Backup.** `pg_dump -Fc` is piped into `age`, with X25519 authenticated encryption. Plaintext never reaches disk. The SHA-256 of the ciphertext is recorded.

**Restore.** Decrypt, then `pg_restore` into a new, uniquely named database. The restore is timed.

**Verify.**
- Every table has the same row count.
- The IOETI schema and the migration ledger are identical.
- Business-line content matches by checksum.

**Integrity.** One flipped byte makes decryption fail, and a different key cannot decrypt.

**Keys.**
- The public recipient key encrypts; the private identity decrypts.
- In development the identity is `.local/backup-identity.txt` (git-ignored, mode 600).
- In production the identity must not be stored on the database or backup host. Custody belongs to D-08.

### Evidence, local dev database (2026-10-19)

| Measure | Result |
|---|---|
| Checks | 10/10 |
| Tables restored | 1,184, identical row counts |
| Backup size and time | 8.5 MB in 2.4 s |
| Restore time | 24.1 s |

**Full recovery boot test, done once locally:**
- `--keep-db` left the restored database in place, and Axelor was started on it with `AXELOR_CONFIG_DB_DEFAULT_URL`;
- all application connections were on the restored database, and boot took 205 s;
- pilot passed and contract was 31/31 against the restored copy;
- the restored database was then dropped.

Measured local recovery time: about 4 minutes (restore 27 s + boot 205 s), excluding getting the key and the file.

Reports: `docs/evidence/platform/`. In CI, the drill (without the boot test) runs after all probes on the CI database.

### Still to do (tracked)

| Item | Owner / gap |
|---|---|
| Scheduled backups, off-site copy, retention, alerting on failure | D-08 hosting |
| Point-in-time recovery (WAL archiving) | D-08 (RPO target decides whether it is needed) |
| Encrypted storage at rest for the database volume | D-08 hosting |
