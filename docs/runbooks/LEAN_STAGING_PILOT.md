# IOETI — Lean internal staging pilot runbook

This work provisions a **reproducible staging recipe**, not a server or production launch. Scope: one small Linux VM, PostgreSQL 16, Java 21, Nginx, systemd, and the pinned Axelor/IOETI modules. Use **fictional test records only** until an actual reviewer signs the acceptance checklist.

## Delivered implementation

- scripts/staging_config.py: checks non-demo mode, real HTTPS origin, three distinct strong secrets, absolute storage paths; renders a private 0600 Axelor config, forcing ddl=none, application.mode=prod, session.cookie.secure=true, non-debug logging, and restricted generic APIs.
- scripts/staging_run.sh: launches the pinned source runner with the staging config; never use the development dispatcher to start staging.
- scripts/ioeti.sh link-modules: links all IOETI extensions without creating a dev .env.
- infra/systemd/ioeti-axelor-staging.service: unprivileged service; externally stored 0600 environment file.
- infra/nginx/ioeti-staging.conf.template: same-origin React static frontend, HTTPS, /axelor-erp reverse proxy, WebSocket upgrade, security headers.
- infra/staging.env.example: all placeholders must be replaced. Never commit the completed file.
- scripts/staging_smoke.py: anonymous-only HTTPS frontend and endpoint-denial checks.
- tests/test_staging_config.py, .github/workflows/ioeti-staging.yml: positive and negative staging safeguards.

## 1. Owner setup, NOT automated by this PR

1. Review the full stacked source, starting from PR #34 and its dependent PRs, before deployment. PR #31 is an integration review reference, not an automatic merge into main.
2. Provision a real restricted staging domain with trusted TLS, a Linux host, Java 21, PostgreSQL 16, Node 22, Nginx. Protect access via VPN or IP allowlist when possible. Expose **only HTTPS 443**; firewall Axelor port 8080 and Postgres 5432 so they are never publicly reachable.
3. Create dedicated user ioeti and a reviewed checkout at /srv/ioeti/current. Provision writable owner-only directories /var/lib/ioeti/config, /var/lib/ioeti/data (attachments, tmp, reports) and /var/log/ioeti.
4. Copy infra/staging.env.example to /etc/ioeti/staging.env, replace all example values with three distinct random credentials (24+ characters); mode 0600, readable by service identity only. Never paste this file into CI logs, PRs or this chat.
5. Rotate the default Axelor admin password **before** letting any real users connect. Static config checks cannot prove the database admin has been rotated. Verify live login and deny original defaults.
6. Assign actual operator, backup key custodian and UAT reviewer (open decisions D-08 and D-09).

## 2. Checkout, DB bootstrap, build

Use the reviewed cumulative branch/commit, with all pinned recursive Axelor submodules and IOETI migrations V001–V009. Link modules and run the tests:

    cd /srv/ioeti/current
    git submodule update --init --recursive
    bash scripts/ioeti.sh link-modules
    python3 -m unittest discover -s tests -p 'test_staging_config.py' -v
    bash -n scripts/staging_run.sh

**Bootstrap prerequisite:** staging deliberately sets db.default.ddl=none. On a *fresh isolated test database only*, complete the documented native Axelor installation/bootstrap procedure under a restricted network, install the required AOS apps, apply the versioned IOETI migrations and run the existing migration verifier on the isolated initialized database. Ensure the schema/ledger matches V001–V009. Do NOT use ddl=update or any destructive dev reset against an existing production database. Only start the protected staging runner after bootstrap.

For a functional draft quotation, AOS needs nontrivial company, stock and accounting configuration. Use the fictional pilot fixtures rather than inventing real tax or ledger decisions.

Build the **real-mode** frontend:

    cd /srv/ioeti/current/apps/ioeti-web
    npm install --no-audit --no-fund
    VITE_IOETI_DEMO=false npm run build

Publish the resulting dist directory into the Nginx read-only web root. Do NOT run Vite's dev server or Vercel's publicly hosted fictional demo against this backend.

## 3. HTTPS host and application

Replace __HOST__, __CERT_FILE__, __KEY_FILE__, __WEB_DIST__ in infra/nginx/ioeti-staging.conf.template, install under nginx's HTTP context (for instance conf.d), then run nginx -t. Reload only if valid. HTTPS must forward the /axelor-erp path *on the same origin* as the frontend so the existing cookie/CSRF auth works; WebSocket upgrades must be forwarded. Restrict direct Axelor and database ports.

Install infra/systemd/ioeti-axelor-staging.service as a system service and ensure its unprivileged user can read /etc/ioeti/staging.env and write /var/lib/ioeti/config, data and logs. Start only after the database is initialized. ExecStart renders the strict config then uses the pinned Gradle source runner. **This source runner is an internal pilot convenience, not yet validated production packaging.**

## 4. Gates before any real customer information

1. On a host with trusted TLS, run: python3 scripts/staging_smoke.py https://YOUR-ACTUAL-STAGING-DOMAIN . It must verify the actual React shell, security headers and anonymous 401/403. This probe is read-only and does NOT prove authenticated security.
2. Browser verification: rotated default admin credential, Secure/HttpOnly/SameSite cookie policy, CSRF on POST, logout invalidation, distinct permitted/denied sales accounts, role/record/field scopes, and Arabic/English/mobile.
3. Run live PostgreSQL/Axelor identity, sessions, WebSocket, scope and concurrency probes on a disposable equivalent environment. Repeat versioned migration and encrypted backup/restore checks. CI test fixtures alone do not prove staging configuration.
4. Use scripts/pilot_readiness.py setup, check, teardown (staging test DB **only**); execute docs/runbooks/PILOT_UAT_SCRIPT.md with a real IOETI reviewer, including the Lead → Opportunity → Quote → Contract draft chain and no stale-write loss. Confirm all test data is removed.
5. Features gated by unapproved D-02 through D-12 policies remain blocked on the **API**, not just the UI: no official certificate, signature, actual invoice, payment, donor receipt or client-private data release.
6. Only the owner can decide real pilot scope and approve subsequent Production V1 go-live after actual UAT and D-08 operational signoff.

## 5. Rollback / caveats

Follow docs/runbooks/DATABASE_MIGRATIONS_AND_RECOVERY.md. Verify an encrypted backup and attachment restore on a separate staging copy; then boot the preceding pinned build and run its tests. Destructive U### migration scripts do not restore business data. Record restore times, key custody and the actual operator.

**No remote server or domain has been configured by this PR.** No customer data was handled; no production deploy, PR merge, official policies or live browser-to-server UAT have been claimed.
