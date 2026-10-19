# Draft upstream report — thread-bound user leaks across HTTP requests (AOP 8.2.x)

**Not yet reported to Axelor** (no external action taken; the project owner decides whether and
how to report, ideally privately via Axelor's security contact / `SECURITY.md`).

## Summary
After an admin triggers an action that runs a `ContextAwareCallable` inline on a Tomcat request
thread (reproduced with *Administration → restore all views*, action
`com.axelor.meta.web.MetaController:restoreAll`), some pooled request threads keep a thread-bound
user (`AuthUtils.CURRENT_USER`). `AuthUtils.getUser()` prefers that thread-local over the HTTP
session, so subsequent requests from *other* users served by those threads are evaluated as the
admin: `AuthSecurity` treats them as admin and skips all permission checks and record filters.

## Versions
Axelor Open Platform 8.2.5 (code read at tag v8.2.4, identical classes), Axelor Open Suite 9.1.10,
embedded Tomcat via `gradlew run`.

## Root cause (source)
- `ContextAwareCallable.call()`:
  `previous = ContextState.capture(); contextState.apply(); try { task.call(); } finally { ContextState.restore(previous); }`
- `ContextState.capture()` stores `AuthUtils.getUser()` — on a request thread this is the **session**
  user resolved through Shiro, even though `CURRENT_USER` itself was empty.
- `ContextState.restore(previous)` with a non-null `previous` calls `previous.apply()` →
  `AuthUtils.setCurrentUser(user)`. The thread now has a `CURRENT_USER` it did not have before; it
  is never removed on that pooled thread.
- `AuthUtils.getUser()` returns `CURRENT_USER` first.

## Reproduction (IOETI repo)
1. Start the app, create a non-admin user whose permission on a model has a record condition
   (IOETI: group `ioeti-bl-viewer`, `self.statusSelect = 2` on `BusinessLine`), and one record the
   condition hides.
2. `python3 scripts/record_filter_leak_probe.py` → 0 leaks (fresh threads).
3. As admin call `restoreAll` (`scripts/ioeti.sh restore-meta`).
4. Re-run the probe → 10–20% of the user's requests return the hidden record, through the generic
   `/ws/rest` search **and** custom JAX-RS resources.

Evidence: `logs/record-filter-leak-probe.fresh-start.json` (0/450),
`logs/record-filter-leak-probe.after-restoreAll.json` (leaks in every scenario).

## Suggested fix
`ContextState.restore(previous)` should restore the *raw* previous thread-local values (capture
`AuthUtils.getCurrentUser()` rather than the resolved user), or `ContextAwareCallable.call()` should
`removeCurrentUser()` when no thread-bound user existed before. Defensive: clear `CURRENT_USER` at
the start/end of every HTTP request.

## IOETI mitigation (implemented)
`modules/ioeti-core/src/main/java/com/ioeti/core/web/StaleThreadUserFilter.java` — a
`@Provider @PreMatching` JAX-RS request/response filter (auto-registered by Axelor's
`MetaScanner`) that clears `CURRENT_USER` before and after every `/ws/*` request. With the filter:
0 leaks in 450 checks after three `restoreAll` calls
(`logs/record-filter-leak-probe.after-2x-restoreAll-with-filter.json`).
Limitation: only JAX-RS endpoints are covered (all Axelor data access from the web client goes
through `/ws/*`); non-JAX-RS servlets are not filtered.
