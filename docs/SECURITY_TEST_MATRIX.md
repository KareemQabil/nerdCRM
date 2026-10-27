# Security test matrix — executed tests only

This matrix lists **tests that ran and passed** on a real Axelor 9.1.10 + PostgreSQL 16 instance (locally and/or in backend CI). Planned rows live in `docs/reverse-mapping/API_SECURITY_NEGATIVE_MATRIX.csv` (52 planned rows); a planned row is not a passing test. Update both when an endpoint is added.

Legend: ✅ passed live · ➖ not applicable · ⬜ not tested yet

| Endpoint | Anonymous | Model denied | Hidden id = missing id | Read-only write | Stale version | Concurrent write | Generic `/ws/rest` bypass | Identity leak under load | Error contract | Probe |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET /ws/ioeti/session` | ✅ 401 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ | identity |
| `GET /ws/ioeti/business-lines[/{code}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ✅ | ✅ | contract, smoke, identity |
| `GET /ws/ioeti/leads[/{id}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | contract, pilot |
| `GET /ws/ioeti/accounts[/{id}]` | ✅ 401 | ⬜ | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ⬜ | ✅ | contract, pilot |
| `GET /ws/ioeti/opportunities[/{id}]` | ✅ 401 | ✅ 403 | ✅ 404 | ➖ | ➖ | ➖ | ✅ 403 | ✅ | ✅ | contract, identity, two-writer |
| `POST /ws/ioeti/opportunities` | ✅ 401 | ⬜ | ➖ | ➖ | ➖ | ⬜ duplicate submit | ➖ | ⬜ | ✅ 400/415/422 | contract |
| `PUT /ws/ioeti/opportunities/{id}` | ✅ 401 | ✅ 403 | ✅ 404 | ✅ 403 | ✅ 409 | ✅ 409, no lost update | ✅ 403 | ✅ | ✅ 400/409 | contract, two-writer, identity |
| `GET /ws/ioeti/security/identity-boundary` | ✅ 401 | ✅ 403 (non-admin) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | identity |
| Generic `/ws/rest`, `/ws/action`, `/ws/meta`, `/ws/app` | ✅ 401 | ✅ 403 for non-maintenance users | ➖ | ✅ refused write leaves record unchanged | ➖ | ➖ | — | ✅ | ✅ | contract, smoke |

Cross-cutting, executed:
- **SEC-001 identity isolation.** Mixed sessions plus metadata reloads give 0 leaks. Before the fix the control build showed 50,731 leaks. (`docs/security/SEC-001-identity-isolation.md`)
- **Blocked user and logged-out cookie.** Both are refused under load (identity probe).

Not yet covered (blocking for the multi-user pilot, see GAP register):
- Own/Team/Line/All role matrix across all endpoints (SEC-003).
- Session expiry, CSRF and cookie flags (SEC-004).
- WebSocket and scheduled-job identity (issue #10).
- Export, attachment and PDF parity (not built yet).
