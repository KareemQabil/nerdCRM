# Railway staging: the full product (web app + Axelor + PostgreSQL) on one URL

Status: rehearsed locally. The production web build ran behind the exact Caddy configuration, with the WAR in a standalone Tomcat 10.1. The live browser scenario (S7) passed through it. The image itself is built and booted in CI by `.github/workflows/ioeti-railway-image.yml`.

This is a **staging/pilot** deployment for reviewing the product. It is not production:
- the schema is created by Axelor at start-up (`db.default.ddl = update`);
- production uses the reviewed migrations (`scripts/db_migrate.py`), a backup plan and owner approval.

## What runs

One Railway service, built from `deploy/railway/Dockerfile` (selected by `railway.json`):

| Piece | Role |
|---|---|
| Caddy on `$PORT` | Serves the web app at `/`, proxies `/axelor-erp` to Tomcat **on the same origin**, rewrites Axelor's cookie path to `/` (the app must read `CSRF-TOKEN`, otherwise every write answers 403), adds security headers, answers `/healthz` once Tomcat responds |
| Tomcat 10.1 + `axelor-erp.war` | Axelor 9.1.10 with every IOETI module. Built from upstream at the pinned commits (`check_pins.sh` keeps them equal to the submodules) |
| `start.sh` | Maps Railway's PostgreSQL variables, refuses to start without the required secrets, renders the configuration (`application.mode = prod`, Secure cookies, Caddy as the only trusted proxy) |
| `bootstrap.py` (every start, idempotent) | Replaces the default `admin/admin` password with `IOETI_ADMIN_PASSWORD`, installs the Axelor apps, and (optionally) seeds the fictional showcase. A showcase seed that stopped half-way is removed and redone |

The web app is the **live** build. Demo mode is refused by `start.sh`.

## Set up (Railway dashboard, about 10 minutes)

1. **New project** → *Deploy from GitHub repo* → `KareemQabil/nerdCRM`. Choose the branch to review (for example `claude/ioeti-enterprise-ux`). Railway reads `railway.json` and builds the Dockerfile. The first build takes 10–15 minutes.
2. **Add PostgreSQL**: *New* → *Database* → *PostgreSQL*. In the app service, reference its variables: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD`, or `DATABASE_URL`.
3. **Add a volume** to the app service, mounted at `/data`. It holds attachments, logs and the rendered configuration.
4. **Service variables.** Generate the values; never reuse a password, and never paste them into chat or commits.

   | Variable | Required | Notes |
   |---|---|---|
   | `IOETI_ADMIN_PASSWORD` | yes | At least 12 characters. Replaces `admin/admin` on first boot |
   | `IOETI_ENCRYPTION_PASSWORD` | yes | Axelor field encryption; keep it stable for the life of the database |
   | `IOETI_BANKORDER_ENCRYPTION_PASSWORD` | yes | Same |
   | `IOETI_SHOWCASE_PASSWORD` | no | When set, seeds 7 fictional people and their records; all sign in with this password |
   | `IOETI_JAVA_HEAP` | no | Default `1536m`. The service needs about 2.5 GB of RAM in total |

5. **Networking**: *Generate domain*. Open `https://<domain>/`.
   - The first start creates the schema and installs the apps; allow 5–10 minutes.
   - The log line `[ioeti-bootstrap] done` marks the end of the bootstrap.

## Known pitfalls (seen on the first Railway deploy)

- **Memory.** Axelor needs about 2.5 GB. A service capped at 1 GB is killed while it starts (`start.sh: line 56: ... Killed`, healthcheck 502). Set the memory under the service's *Settings → Resource limits* in the dashboard and check that the deployment's memory limit metric shows it; a limit set only through the API did not reach the container.
- **Branch.** Reconnecting the GitHub source in the dashboard selects `main` by default; `main` has no `deploy/railway/Dockerfile` until this work is merged. Choose the reviewed branch.
- **App data language.** Axelor ships app init data (lead and opportunity statuses, sequences...) only in English and French. With `application.locale = ar` it imported nothing and still reported the apps as installed, so the showcase failed with "Please fill default lead status in App CRM configuration". `scripts/install_apps.py` now installs the apps with English init data and repairs apps installed in another language. The web app stays Arabic; native status names are shown in Arabic by the UI.

## Showcase accounts (when `IOETI_SHOWCASE_PASSWORD` is set)

| Login | Person (fictional) | Sees and does |
|---|---|---|
| `showcase.sara` | سارة منصور | Sales: leads, follow-ups, a converted client, quotation, milestones, draft contract |
| `showcase.hany` | هاني فؤاد | Reviewer: a quotation waiting for review; edits the knowledge base |
| `showcase.karim` | كريم حسن | Operations: handover checklist |
| `showcase.mona` | منى عادل | Certification: cycle, audits, a finding |
| `showcase.laila` | ليلى سمير | Training: cohort, waitlist, attendance |
| `showcase.omar` | عمر شريف | Recruitment: job order and pipeline |
| `showcase.nour` | نور الهدى | Fundraising: grant, commitment, installments, collection |

Steps that policy blocks stay blocked and say why. The showcase never fakes them; contracts stay in draft:
- D-11: activation, approval, handover from an active contract;
- D-06: invoicing;
- D-02: certification decision;
- D-03: certificates;
- D-04/D-05: sharing and receipts;
- D-10: sending.

## Checks after deploying

- `https://<domain>/healthz` → `ok`.
- Sign in as `admin` with `IOETI_ADMIN_PASSWORD`; `admin/admin` must fail.
- Record a lead and convert it. Any write that answers 403 means the cookie-path rewrite is not in front of Axelor.
- `scripts/live_ui_fixture.py` and `tests/live.spec.ts` can run against the domain from a workstation:
  - set `IOETI_BASE_URL=https://<domain>/axelor-erp` for the fixture;
  - set the Playwright `baseURL` to the domain.

## Not covered here (owner decisions)

- Production hosting, backups and restore drills on the host.
- The reviewed-migration rollout (`db.default.ddl = none`).
- Custom domain and TLS policy.
- The D-07 role matrix for real users.
