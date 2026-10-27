# SEC-002 (part 1): IOETI API error contract, existence oracle, generic API exposure

Gaps: **G-006** (error contract), **G-003** (generic REST field exposure), part of **G-007**.
Issue #11. Status: **LIVE_INTEGRATION_PASS** and **NEGATIVE_SECURITY_PASS** for the endpoints that exist today. Endpoints still listed as `NOT_IMPLEMENTED` in `docs/reverse-mapping/UI_API_SURFACE_CONTRACTS.json` inherit the mechanism, but each still needs its own tests when it is built.

## 1. Why the AOS handler was replaced on IOETI endpoints

The pinned `axelor-utils` 4.0.2 `HttpExceptionHandlerImpl` (bytecode reviewed in PR #6) maps:

| Exception | Status |
|---|---|
| `BadRequestException` | 400 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| **any other** `ClientErrorException` | **409** |
| any other exception | **500 with `e.getMessage()`** |

Under that handler a 422 or 429 would be reported as 409, and a database error would reach the browser verbatim. IOETI endpoints therefore use `@IoetiEndpoint` (`com.ioeti.core.api`) instead.

## 2. Contract (all of `/ws/ioeti/*`)

```json
{"codeStatus": 404, "messageStatus": "Not found.",
 "error": {"code": "NOT_FOUND", "message": "Not found.", "correlationId": "…", "fields": []}}
```

- `codeStatus`/`messageStatus` keep the shape the custom UI already reads. `error` is the typed part.
- Codes: `INVALID_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `CONFLICT` 409, `UNSUPPORTED_MEDIA_TYPE` 415, `VALIDATION_FAILED` 422 (with `fields[{field, code, message}]`), `BLOCKED_BY_POLICY` 422, `RATE_LIMITED` 429, `INTERNAL_ERROR` 5xx.
- Messages:
  - fixed per status, unless an endpoint throws `ApiException`, whose message is written for users;
  - internal exception text is never returned;
  - 5xx failures are logged server-side with the correlation id.
- **Correlation id.**
  - Source: the request's `X-Correlation-Id` header if it is safe (`[A-Za-z0-9-]{8,64}`), otherwise a generated UUID.
  - Echoed in the response header and the error body, and placed in the SLF4J MDC.
- **Failures outside endpoint methods** (malformed JSON, unknown path, wrong method or content type) are normalised by `IoetiApiFilter`.
- **401 exception.** A 401 for a missing session is produced by Shiro/pac4j before JAX-RS runs. There, only the status is contractual.
- **UI side.**
  - `ApiError` exposes `code` and `fields`.
  - The opportunity form maps 422 field errors to Arabic/English labels; it never shows raw server text.

## 3. Existence oracle (`RecordAccess`)

| Caller situation | Answer |
|---|---|
| no permission on the model at all | 403 (says nothing about any record) |
| record missing, **or** present but outside the caller's read scope | the same 404 |
| readable but not writable | 403 (existence is already known) |

Read and write access are two queries. If a concurrent commit moves the record out of the caller's scope between them (another rep picks up a queued lead), the failed write check is followed by a fresh read check, and a record the caller can no longer read answers 404, not 403. Found by the Wave 2 lead pickup race (`scripts/lead_lifecycle_probe.py`).

Applied to the Opportunity, Lead and Account GETs and to the Opportunity PUT. Business lines use a code lookup through the read filter. An unknown, unreadable or inactive line on create gives one identical 422.

## 4. Generic Axelor API exposure (G-003)

`GenericApiExposureFilter` returns 403 to non-maintenance users on every `/ws` path except `/ws/ioeti/*` and `/ws/public/*`.
- **Maintenance users**: the administrator, plus the groups in `ioeti.security.maintenance-groups` (default `admins`).
- **Scope**: this closes the generic route through which field-level read rules were bypassed (see `docs/SECURITY_MODEL.md`), for every ordinary user.
- **Development switch**: `ioeti.security.generic-api=open` is for isolated development only. Any other value, including none, keeps the gate restricted.
- **Consequence (ADR-001)**: non-maintenance users cannot use the native Axelor UI. The custom UI uses only `/callback` and `/ws/ioeti/*`.
- **Still open**: maintenance users still see every field through the native API, by design. Sensitive data still needs structural isolation (G-007, SEC-004).

## 5. Evidence

| Check | Result |
|---|---|
| `scripts/api_contract_probe.py` (also in backend CI) | **31/31 PASS** |
| `scripts/api_smoke_test.py` | 16/16 (its generic-search check now expects 403) |
| `scripts/identity_isolation_probe.py` | 0 leaks / 310,904 checks |
| Two-writer probe | 20/20 |
| Pilot | PASS |
| `scripts/field_permission_probe.py` | the restricted user's generic search/fetch is refused with 403 |
| JUnit | 41/41, including 7 `ApiErrorsTest` |
| Web | build passes; mocked browser 18/18 (new: localized 422); demo 14/14 |

What the 31 probe checks cover:
- hidden and missing ids give identical answers on four GETs and on PUT;
- readable but not writable answers 403;
- the contract and correlation id hold for 404, 400, 405, 409, 415, 422 and bad paging;
- no internal text appears in any error body;
- the generic API is closed to ordinary users across six routes, and still open to the admin;
- a refused generic write leaves the record unchanged;
- account pages are full and contain clients only;
- DTO allowlists hold.

Evidence: `docs/evidence/sec-002/` (results only; no bodies or credentials).

## 6. Not done here

| Item | Where it is tracked |
|---|---|
| Rate limiting (429) | SEC-004 |
| Hidden related-record counts in future aggregate endpoints | each domain PR must test |
| Export / print / attachment parity | not built yet |
| Structural isolation of sensitive fields | G-007 |
