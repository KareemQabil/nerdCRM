# P4a: role templates, deny by default (D-07)

Status: implemented and checked against the real backend.
- `scripts/roles_probe.py` passes 22/22 (backend CI), twice in a row with complete cleanup.
- `RoleAdminRulesTest` passes 5/5.
- The admin probe (43/43) and the scope matrix probe (65/65) still pass.
- Mocked browser test: creating a profile and editing its rights.

D-07 (signed 2026-10-25) says: **editable role templates, deny by default** (sales rep, sales manager, GM, marketing, operations,
auditor/trainer, finance, fundraising, read-only, policy owner).

## What a template is

A template names a job and the role the platform's policies refer to. A profile created from it gets that role and **no
rights**. The administrator then grants only what the job needs.

| Template | Role |
|---|---|
| Sales rep | `ioeti-sales-rep` |
| Sales manager | `ioeti-sales-manager` (a D-11 approver and signatory) |
| GM | `ioeti-gm` (a D-11 approver and signatory) |
| Marketing | `ioeti-marketing` |
| Operations | `ioeti-operations` |
| Auditor / trainer | `ioeti-auditor-trainer` |
| Finance | `ioeti-finance` |
| Fundraising | `ioeti-fundraising` |
| Read only | `ioeti-read-only` |

**The policy owner is not a template here.** Owners are appointed by owners under Policies (P1). An administrator therefore
cannot grant themselves the right to change business rules, which keeps principle P intact.

## Rights

A right is a native Axelor permission on the profile (group). The platform's endpoints already enforce these permissions; this
slice only writes them. For each record type it holds:

- **Actions:** read, write, create, remove. Changing records requires reading them (`422 read REQUIRED`).
- **Scope:** the SEC-003 scopes, offered only where the record type carries the field:

| Scope | Condition | Record types |
|---|---|---|
| Own | owner field `= ?` (`__user__`) | leads, accounts, opportunities, activities, quotations and their lines, payment milestones, contracts |
| Team | `team in (?)` (`__user__.teamSet`) | leads, accounts, opportunities, quotations |
| Business line | business line `in (?)` (`__user__.ioetiBusinessLines`) | leads, opportunities, quotations and their lines, contracts, business lines |
| All | none | every type |

- **Catalogue:** the record types are the 51 the platform's screens check, grouped by area.
  - Candidate and donor private data are marked **restricted**. They are granted whole or not at all, with no scope.
  - Anything outside the catalogue is refused (`422 object UNKNOWN`).
- **Removing a right:** all four actions off removes it.

### What is refused

- **The administrators' profile is fixed:** `422 ADMIN_PROFILE_FIXED`.
- **A right written elsewhere:** if a profile already has a right on a record type that this editor did not write (for example
  the showcase fixtures), it is shown but not edited (`422 RIGHT_MANAGED_ELSEWHERE`). Axelor adds a person's rights up, so a
  second permission would widen access instead of changing it.
- **Concurrent edits:** every change moves the profile's version, so two administrators editing the same profile get `409` on
  the second save.

### When a change applies

On the next request. The probe shows this:
- no right → `403`;
- own → only the person's lead;
- all → both leads;
- off → `403` again.

## Audit

Two events go to the admin change log, in the same transaction as the change:
- `PROFILE_CREATED`: the template, the role, and "rights=none";
- `PROFILE_RIGHT_SET`: the change as before → after, for example `Lead: none→read@OWN`.

## API (`/ws/ioeti/admin`, administrators only)

| Method | Path | Body |
|---|---|---|
| `GET` | `/role-templates` | — (templates and record types with their scopes) |
| `POST` | `/profiles` | `{code, name, template}` → 201 |
| `POST` | `/profiles/{code}/rights` | `{version, object, read, write, create, remove, scope}` |
| `GET` | `/profiles/{code}` | now also returns `version`, `roles`, and per right its `key`, `scope` and `managed` |

## Screen

Admin console › Access profiles:
- **New profile:** choose a template, a name and a code.
- **Rights:** the profile opens on a matrix grouped by area, with read, edit, create and delete per record type, and a scope
  picker where the type has scopes.
- **Saving:** each change saves at once with the profile's version. Ticking an action that changes records ticks reading,
  and unticking reading clears the rest.
- **Read-only rows:** restricted data carries a badge; rights managed elsewhere are shown read-only.

## Not in this slice

- **Field-level rights.** The private parts of candidates and donors are separate record types (restricted). Other field
  rules stay in the PII registry and the DTOs.
- **Optional MFA:** P4b.
- **Retention review queue:** P4c.
