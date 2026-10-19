# IOETI endpoint/security coverage — proposed ACLs and negative tests

This is a **planning/verification matrix**, not an implemented security policy. All 52 UI/API surfaces in `UI_API_SURFACE_CONTRACTS.json` have a corresponding row in `API_SECURITY_NEGATIVE_MATRIX.csv`.

## Invariants

Every endpoint, regardless of whether current or proposed, must verify authentication AND model right AND record scope; any projected field must be explicitly allowlisted and validated for intended role/field sensitivity. Related collections require **independent** per-record and per-field authorization of each related object. Database queries must apply the server-side visibility predicate before pagination/filtering/sorting. Search and export never bypass row or field permissions. A forged URL must not reveal record existence, its relationships or raw exception details beyond the decided 404/403 policy.

## Roles are not yet policy

The CSV's `business_roles_proposed_not_approved` column is a design hypothesis. It does **not** grant rights or replace native Axelor model/record security. Actual IOETI role hierarchy, business-line membership, delegated acts, temporary access and sensitive fields need owner-approved policy plus server-side enforcement.

**Privacy-critical:** Certification decision maker must be independent of auditors; external trainee records cannot inherit employee HR permissions; candidate submission/attachments require lawful and audit-logged consent; donor personal details and pledge amounts cannot leak via sales accounts; finance costs/margins must be structurally protected; DMS file URLs require parent record + file ACL.

## Test-class recipe per surface

1. Anonymous access must not return confidential objects.
2. Authenticated unauthorized actor must not infer protected identifiers through code/message timing or list counts.
3. Allowed/denied clients must be tested in the SAME fixture database with mixed owned/team/business-line records.
4. A denied mutation must not change the persisted row, its version, side effects or linked object.
5. Unexpected exceptions must produce a safe stable error contract, with no SQL/JPA internals.
6. Source field allowlist should prove forbidden field **absence** and no surplus JSON attributes.
7. Conflicting concurrent writes must rollback loser; no double success/invoice/certificate and no lost update.
8. Cross-boundary read: a permitted Account does not automatically grant related Quote/Contract/Finance/Donor/Recruitment records.
9. Export and PDF endpoints enforce the same or stricter scope than UI.
10. Test the real Axelor + PostgreSQL backend; Playwright's mocked fixtures **alone** are not authorization proof.

## How to close

For each `surface_id`, produce:
- exact source symbols and route/method implementation path;
- approved role/record/field policy (with accountable business owner);
- negative suite and version/concurrency evidence;
- UI route and error/empty/retry states;
- CI URL and accepted deployment/staging environment.

Only then promote `implementation_state` out of NOT_IMPLEMENTED or a draft-PR state. PR #6 version-guard and PR #8 Opportunity UI are separate reviews and not blanket coverage.
