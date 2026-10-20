# Security test matrix — executed tests only

This matrix lists **tests that ran and passed** on a real Axelor 9.1.10 + PostgreSQL 16 instance (locally and/or in backend CI). Planned rows live in `docs/reverse-mapping/API_SECURITY_NEGATIVE_MATRIX.csv` (52 planned rows); a planned row is not a passing test. Update both when an endpoint is added.

Legend: ✅ passed live · ➖ not applicable · ⬜ not tested yet

| Endpoint | Anonymous | Model denied | Hidden id = missing id | Read-only write | Stale version | Concurrent write | Generic `/ws/rest` bypass | Identity leak under load | Error contract | Probe |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET /ws/ioeti/session` | ✅ 401 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ | identity |
| `GET /ws/ioeti/business-lines[/{code}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ✅ | ✅ | contract, smoke, identity |
| `GET /ws/ioeti/leads[/{id}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | contract, pilot |
| `GET /ws/ioeti/accounts[/{id}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | contract, pilot |
| `POST /ws/ioeti/leads/{id}/convert` | ⬜ | ✅ 403 (no write) | ✅ 404 | ✅ 403 | ✅ 409 | ✅ one 201 + one 409, no duplicates | ✅ 403 | ⬜ | ✅ 400/409/422 | lead-conversion |
| `GET /ws/ioeti/catalog/products` | ⬜ | ⬜ | ➖ | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ 422 search | quote |
| `GET /ws/ioeti/quotes[?opportunityId][/{id}]` | ⬜ | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | quote |
| `POST /ws/ioeti/quotes` | ⬜ | ✅ 403 | ✅ 404 | ✅ 403 | ✅ 409 | ⬜ | ✅ 403 | ⬜ | ✅ 400/409/422 | quote |
| `POST /ws/ioeti/quotes/{id}/lines` | ⬜ | ⬜ | ✅ 404 | ⬜ | ✅ 409 | ✅ one 201 + one 409, one line | ✅ 403 | ⬜ | ✅ 409/422 | quote |
| `GET/POST /ws/ioeti/quotes/{id}/milestones`, `DELETE …/{milestoneId}` | ⬜ | ⬜ | ✅ 404 | ⬜ | ✅ 409 | ✅ one 201 + one 409, total ≤ 100 % | ✅ 403 | ⬜ | ✅ 400/409/422 | quote |
| `POST /ws/ioeti/quotes/{id}/milestones/{milestoneId}/invoice` | ⬜ | ➖ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ 422 `BLOCKED_BY_POLICY` | quote |
| `GET /ws/ioeti/contracts[?opportunityId][/{id}]` | ⬜ | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | quote |
| `POST /ws/ioeti/contracts` | ⬜ | ✅ 403 | ✅ 404 | ✅ 403 | ✅ 409 | ✅ one 201 + one 409, one contract per opportunity | ✅ 403 | ⬜ | ✅ 400/409/422 | quote |
| `POST /ws/ioeti/contracts/{id}/lines-from-quote` | ⬜ | ⬜ | ✅ 404 | ⬜ | ✅ 409 | ✅ one 201 + one 409, lines copied once | ✅ 403 | ⬜ | ✅ 409/422 | quote |
| `POST /ws/ioeti/contracts/{id}/activate`, `/handover` | ⬜ | ➖ | ⬜ | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ 422 `BLOCKED_BY_POLICY` / `CONTRACT_NOT_ACTIVE` | quote |
| `POST /ws/ioeti/quotes/{id}/finalize` | ⬜ | ➖ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ 422 `BLOCKED_BY_POLICY` | quote |
| `GET /ws/ioeti/accounts/{id}/contacts`, `/opportunities` | ⬜ | ➖ | ✅ 404 (non-client = missing) | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | lead-conversion |
| `GET /ws/ioeti/opportunities[/{id}]` | ✅ 401 | ✅ 403 | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ✅ | ✅ | contract, identity, two-writer |
| `POST /ws/ioeti/opportunities` | ✅ 401 | ⬜ | ➖ | ➖ | ➖ | ⬜ duplicate submit | ➖ | ⬜ | ✅ 400/415/422 | contract |
| `PUT /ws/ioeti/opportunities/{id}` | ✅ 401 | ✅ 403 | ✅ 404 | ✅ 403 | ✅ 409 | ✅ 409, no lost update | ✅ 403 | ✅ | ✅ 400/409 | contract, two-writer, identity |
| `GET /ws/ioeti/security/identity-boundary` | ✅ 401 | ✅ 403 (non-admin) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | identity |
| Generic `/ws/rest`, `/ws/action`, `/ws/meta`, `/ws/app` | ✅ 401 | ✅ 403 for non-maintenance users | ➖ | ✅ refused write leaves record unchanged | ➖ | ➖ | — | ✅ | ✅ | contract, smoke |

Cross-cutting, executed:
- **SEC-001 identity isolation.** Mixed sessions plus metadata reloads give 0 leaks. Before the fix the control build showed 50,731 leaks. (`docs/security/SEC-001-identity-isolation.md`)
- **Blocked user and logged-out cookie.** Both are refused under load (identity probe).

Sessions and authentication (SEC-004, `scripts/session_security_probe.py`):

| Control | Result |
|---|---|
| Session id rotated at login | ✅ |
| Session cookie `HttpOnly` + `SameSite` Lax/Strict | ✅ |
| CSRF on IOETI writes: missing / forged token refused, real token accepted, refused writes persist nothing | ✅ |
| Logout: old cookie refused on session and data endpoints | ✅ |
| Idle session expiry; active session survives | ✅ (separate CI job) |
| Login throttle per username + address: 429 + `Retry-After` before credential check | ✅ |
| Login throttle per address, and its release after the window | ✅ (expiry job) |
| `Secure` cookies over HTTPS | ⬜ needs an HTTPS staging environment |

Record scopes (SEC-003, `scripts/scope_matrix_probe.py`, test-only role fixtures):

| Scope | List = scope | GET in/out (out = missing) | PUT in/out, no change on refusal | Generic API | Create by membership |
|---|---|---|---|---|---|
| Own (RepA, RepB) | ✅ | ✅ | ✅ | ✅ 403 | ✅ refused without membership |
| Team (Manager) | ✅ | ✅ | ✅ | ✅ 403 | ➖ |
| Business Line (LineIso; LineNone with no lines) | ✅ | ✅ | ✅ | ✅ 403 | ✅ member line only; revocation effective next request |
| All | ✅ | ✅ | ✅ | ✅ 403 | ➖ |
| Read-only (no opportunity permission) | ✅ 403 | ✅ 403 | ➖ | ✅ 403 | ➖ |

Lead conversion (Wave 2, `scripts/lead_conversion_probe.py`, test-only role fixtures): every refusal is verified to persist nothing:
- no opportunity or partner is created;
- the lead stays unconverted;
- a non-member line and a non-client or unknown `accountId` each answer one identical 422;
- the native lost-lead rule answers 422 `CONVERSION_REJECTED` with a fixed message;
- Account 360 opportunities follow the caller's own scope.

WebSocket and scheduled jobs (issue #10, `scripts/websocket_identity_probe.py`):

| Control | Result |
|---|---|
| Anonymous WebSocket handshake refused | ✅ |
| Each WebSocket answer uses the asking user's identity under concurrent HTTP traffic and a metadata reload | ✅ 0 mismatches / 5,516 |
| Logout closes an already-open WebSocket (IOETI `WebSocketSessionGuard`; AOP alone kept answering) | ✅ |
| New handshake with a logged-out cookie refused | ✅ |
| Session expiry closes an idle open WebSocket | ✅ (expiry job) |
| Scheduled (Quartz) job never sees a request user | ✅ 28 runs, 0 with a user |

Not yet covered (blocking for the multi-user pilot, see GAP register):
- Production role matrix (D-07); scopes on leads, accounts and future domains.
- Export, attachment and PDF parity (not built yet).
