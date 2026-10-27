# Security model — what Axelor really enforces, and what IOETI must add

Evidence sources: AOP 8.2.4/8.2.5 source (`AuthSecurity`, `AuthResolver`, `Resource`,
`MetaPermissions`), and live tests against the local instance:
`scripts/api_smoke_test.py` (16/16 PASS) and `scripts/field_permission_probe.py`
(report in `logs/field-permission-probe.json`).

## 1. Mechanisms and verified behaviour

| Mechanism | Where | Enforced on | Verified |
|---|---|---|---|
| Admin bypass | `AuthSecurity.getUser()` returns null for admin user / `admins` group → every check returns true | everything | source |
| Model permission (`auth_permission`: canRead/Write/Create/Remove/Import/Export) attached to user, group or role | `AuthSecurity.isPermitted` | generic `/ws/rest`, UI, any code using `JpaSecurity`/`SecurityCheck` | **running**: viewer cannot read Opportunity, cannot update BusinessLine ("You are not authorized…") |
| **Deny by default** for non-admin | `isPermitted`: no matching permission → `false` | same | **running**: viewer has no Opportunity permission → denied |
| Record-level condition (`condition` + `conditionParams` on a permission) | `AuthSecurity.getFilter` → JPQL filter | generic `/ws/rest` search/fetch; custom code **only if it applies `JpaSecurity.getFilter`** | **running**: `self.statusSelect = 2` hides suspended lines in both generic API and IOETI API |
| Field rule (`MetaPermission` / `MetaPermissionRule`: canRead/canWrite/canExport/hideIf/readonlyIf) | `MetaPermissions` used by `Resource` **only in export (`canExport`) and mass update (`canWrite`)**; views use it to hide/readonly | UI views, CSV export, mass update | **running (negative): `canRead=false` on `description` is NOT applied to `/ws/rest` search or fetch — value returned** |
| Authentication | pac4j form/JSON login `POST /callback`, MFA domain (`MFA`, `MFAService`), OIDC/SAML via pac4j config | all `/ws/*` | **running**: anonymous → 401, bad password → 401, disabled user → 401 |
| Audit | entity `<track>` (mail tracking, used by BusinessLine), AOP `AuditLog`, AOS `GlobalTrackingLog` | — | tracking declared; global log not exercised |

### Upstream vulnerability found and mitigated: thread-bound user leak
After an admin runs an action that executes a `ContextAwareCallable` inline on a request thread
(reproduced with "restore all views"), pooled Tomcat threads keep the admin as thread-bound user and
later requests of **other users** are evaluated as admin (all permission checks and record filters
skipped). Measured with `scripts/record_filter_leak_probe.py`: 0/450 leaks on fresh threads,
10–20% leaking after one `restoreAll`, 0/450 with the IOETI mitigation
`com.ioeti.core.web.StaleThreadUserFilter` (clears the thread-bound user before/after every `/ws/*`
request). Details and suggested upstream fix: `docs/upstream-issues/AOP-thread-bound-user-leak.md`.
**Keep `ioeti-core` installed in every environment** and re-run the probe after each AOP upgrade.
**SEC-001 (current control):** `com.ioeti.core.security.RequestIdentityBoundaryFilter` is registered before `GuiceFilter`, so it also covers Shiro/pac4j and non-JAX-RS servlets. The live probe is `scripts/identity_isolation_probe.py`, which also runs in CI. See `docs/security/SEC-001-identity-isolation.md`.

### Pitfalls found while testing
- The generic API returns **HTTP 200 with `"status": -1`** for authorization errors. Clients and
  tests must check the payload status, not only the HTTP code.
- Creating a `User` through `/ws/rest` stores `password` **as given** (no hashing) and creates the
  user with `blocked = true`. Use the UI/password-change flow or hash with Shiro
  (`scripts/support/HashPassword.java`). Never create users with plaintext passwords via the API.
- `/ws/rest/*` exposes **every** model the user may read, with any field. With field rules not
  enforced on read, the generic API must not be the integration surface for restricted roles.
  **SEC-002:** `com.ioeti.core.api.GenericApiExposureFilter` now answers 403 on every generic `/ws` route for users outside `ioeti.security.maintenance-groups` (default: the administrator and `admins`). See `docs/security/SEC-002-api-contract.md`.

## 2. IOETI record scopes mapped to Axelor

| Scope | Axelor implementation | Status |
|---|---|---|
| Own | permission condition `self.user = ?` / `self.createdBy = ?` with `conditionParams = __user__` (AOS roles use this pattern) | to configure per model |
| Team | condition on `self.team in (?)` with `__user__.teamSet` / active team; nested teams need a helper (AOP has no team hierarchy) | needs IOETI helper (team tree) |
| Business line | condition `self.ioetiBusinessLine in (?)` with the user's business lines (new M2M `User.ioetiBusinessLines` in `ioeti-core`) | design ready; field on Opportunity exists |
| All | unconditional permission (or wildcard object `com.axelor.apps.crm.db.*`) | native |

Conditions are OR-ed across a user's permissions (`Filter.or` in `AuthSecurity.getFilter`), so a
user in "Own" and "Business line" groups sees the union — matches the spec.

## 3. Sensitive fields (cost price, margin, candidate salary, donor data, national ID)

Because field rules are not enforced on API reads, IOETI rules:
1. **Structural isolation**: sensitive values live in separate entities (e.g. `ServiceCost`,
   `CandidateCompensation`, `DonorPrivateData`, `TraineeIdentity`) linked 1-1 to the main record and
   protected by **model-level** permissions (deny by default).
2. **IOETI APIs return DTOs**, never entities. Example: `BusinessLineResponse` exposes only the
   contract fields — the restricted probe user received no `description` from
   `/ws/ioeti/business-lines/ISO9001`.
3. Field rules (`MetaPermission`) are still used for UI hiding and export control, never as the
   only protection.
4. For roles that must not use the generic API (field sales, trainers, auditors, fundraising), the
   reverse proxy should restrict `/ws/rest/*` and `/ws/action` to admin/back-office networks
   **(decision pending; not implemented in this phase)**.

## 4. Invariants for every IOETI module (also in AGENTS.md)
- Every new entity ships permissions in `data-init` (or Studio role CSV) — deny by default.
- Every custom REST resource calls `new SecurityCheck().readAccess(...)` / `writeAccess(...)` **and**
  applies `JpaSecurity.getFilter` to queries returning lists (see `BusinessLineRestController`).
- Domain rules are enforced in repositories / JPA listeners, not only in views
  (`BusinessLineManagementRepository`, `OpportunityBusinessLineListener`).
- Every rule has a negative test (API smoke test pattern).

## 5. Tests in place
`scripts/record_filter_leak_probe.py` — regression probe for the thread-bound user leak (run it
after an admin `restore-meta`; any non-zero leak count is a release blocker).

`scripts/api_smoke_test.py` — includes 6 negative checks: suspended line hidden (IOETI API),
fetch by code → 404, generic search filtered, update denied, opportunity read denied, anonymous
refused. `scripts/field_permission_probe.py` documents the field-rule gap (expected to keep
"leaking" until IOETI adds a server-side mitigation; re-run after AOP upgrades).
