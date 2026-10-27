# SEC-001 — Request authentication-context isolation

Status: **OPEN**.
- **HTTP request surfaces: VERIFIED**, locally on Axelor 9.1.10 + PostgreSQL 16 and in CI on this branch.
- **WebSocket message handlers and background jobs: SOURCE_REVIEWED only.**
- **Session expiry: NOT TESTED.**

See §6 for what keeps it open. The reverse map tracks this as gap `G-002`.

## 1. Invariant

For every HTTP request:
- the effective identity comes from that request's session, or there is none;
- it is never inherited from an earlier request served by the same pooled thread;
- the thread is released without a thread-bound identity, whether the request succeeded or failed.

Admin work must not raise the privileges of later requests. Background jobs keep the identity they set explicitly.

## 2. Exact versions inspected

| Artifact | Coordinates | SHA-256 |
|---|---|---|
| AOP core (runtime jar) | `com.axelor:axelor-core:8.2.5` | `fb90c2944dca42f06a4f1df2a12ef7d68d37730883b4bec93ed64efad4d1b0d6` |
| AOP core sources | `com.axelor:axelor-core:8.2.5:sources` (repository.axelor.com) | `e3b3313bca941a6c0a4c59eda78f5cb3cc52c08cc6abf4c6124ead66e4c9daeb` |
| AOP web (runtime jar, contains `web.xml`) | `com.axelor:axelor-web:8.2.5` | `d29cc17c4cd6434862aa3793952c1acb22e62cd13e1b9ea0f7b8b53df3eb9c94` |
| AOP web sources | `com.axelor:axelor-web:8.2.5:sources` | `08defdc937aa1367fbca086c72089b38f65885339e506dfb75b82b7f1f73cc58` |
| Embedded Tomcat runner (jar / sources) | `com.axelor:axelor-tomcat:8.2.5` | `00e2a756eda59ab2bf9db37d79cf542d26347816303de6d0efcc36f378c676f4` / `4435ef8c4a898861e730c9ab2ac77470e28a72480ce6b4cbf4069268ad52c3f6` |

Other versions in the stack: AOS 9.1.10 (`e7cbea53`), Studio 4.0.7, Utils 4.0.2, Java 21, PostgreSQL 16. The root cause below was read in the **8.2.5 sources**, not in the v8.2.4 tag used earlier.

## 3. Root cause (AOP 8.2.5, upstream; not patched here)

- `AuthUtils.getUser()` returns the thread-local `CURRENT_USER` first, and falls back to the Shiro session subject only when it is empty.
- `ContextAwareRunnable/Callable` run `previous = ContextState.capture(); … finally ContextState.restore(previous)`.
  - `capture()` stores the *resolved* `AuthUtils.getUser()`. On a request thread, that is the session user.
  - `restore()` re-applies it with `setCurrentUser`.
  - So a context-aware task run **inline on a request thread** leaves `CURRENT_USER` set after the request.
- Inline call sites include `ModuleManager.installModules` (reached from *restore all views*) and `MailServiceImpl.fetch()`.
- Whoever triggered the task becomes the identity of later requests served by that thread.
- Readers of `AuthUtils.getUser()` *before* any application code include `pac4j.AxelorUserAuthorizer` (the active-user check) and `AxelorLoginFilter`. A JAX-RS-only fix therefore cannot cover them.

The project owner decides on, and sends, a private report to Axelor. The draft is kept outside the repository.

## 4. Control implemented (IOETI extension only, upstream untouched)

`com.ioeti.core.security.RequestIdentityBoundaryFilter` clears `CURRENT_USER` at request entry and, in `finally`, at exit. It never touches it in between, and it never runs on scheduler or executor threads.

`RequestIdentityBoundary` registers the filter while the web injector is being built. That happens inside `AppContextListener.contextInitialized`, a listener declared in `web.xml`, where `ServletContext.addFilter` is permitted. The mapping is `/*`, with dispatcher types REQUEST, ASYNC and ERROR, and `isMatchAfter=false`. That places it **before `GuiceFilter`**, and therefore before Shiro/pac4j, every Guice filter, RESTEasy and all servlets. The mechanism is the same in the embedded dev Tomcat, in CI and in a WAR deployment (no jar scanning).

If a servlet context exists but the filter cannot be installed, startup **fails closed**.

`StaleThreadUserFilter`, the earlier JAX-RS-only mitigation, stays as a second layer for `/ws/*`.

`GET /ws/ioeti/security/identity-boundary` is **admin-only**. It reports `registered`, `requests`, `staleAtEntry` and `clearedAtExit`.

## 5. Evidence

### Live probe

`scripts/identity_isolation_probe.py` runs on Axelor 9.1.10 + PostgreSQL 16 with throw-away fixtures, all deleted afterwards.

| Principal | Access |
|---|---|
| A | own opportunities only, plus line ISO9001 |
| B | own opportunities only, plus line TRAINING |
| RO | active lines only, no opportunities |
| ANON | no session |
| BLK | live session, then blocked by the admin |
| OUT | logged out, keeps sending the old cookie |

- Two sessions per principal run concurrently.
- Meanwhile the admin reloads metadata twice, abandons a third reload after 2 s, and reloads once more to prove the abandoned one has finished.
- Failing requests are interleaved: malformed bodies, unknown actions, invalid paging.
- Writes are attempted with the record's real version, so an escalated write would succeed.

| Build | Checks | Cross-identity results | Boundary counters |
|---|---|---|---|
| No mitigation (control) | 313,962 | **50,731 leaks**: wrong identity, foreign records, denied data visible, anonymous `/ws/public/app/info` returned an identity, **unauthorised writes accepted and persisted** | n/a |
| JAX-RS filter only (PR #6 head) | 281,298 | 0 | n/a |
| Boundary + JAX-RS filter (this PR) | 317,623 | 0 | `staleAtEntry 0` over 331,831 requests |
| Boundary only (JAX-RS filter removed) | 320,752 | 0 | `staleAtEntry 0`, **`clearedAtExit 4`** = every reload request ended with a pinned identity, and the boundary removed it |

The reports are in `docs/evidence/sec-001/`: counts only, with no credentials, cookies or response bodies.

### JUnit

`RequestIdentityBoundaryFilterTest` (8 tests):
- entry clear, exit clear, and clear on checked and unchecked failures;
- identity set on purpose inside a request stays visible;
- other threads' identity is untouched;
- registration is first, for all URLs, and idempotent;
- startup fails closed.

`RequestIdentityBoundaryIntegrationTest` (3 tests) uses the real AOP 8.2.5 `ContextAware`/`AuthUtils`, JPA and a bound Shiro subject. It reproduces the pinning **deterministically**, then shows that the boundary releases the thread clean without changing the identity inside the task. If the first test starts failing after an AOP upgrade, upstream changed and this document must be revisited.

### CI

`.github/workflows/ioeti-backend.yml` now runs, on every PR touching `modules/**`, `gradle/**` or `scripts/**`:
- the JUnit suite;
- a real Axelor + PostgreSQL startup;
- the pilot;
- the two-writer probe;
- the identity probe.

Any cross-identity result fails the job. The probe reports are uploaded as an artifact.

## 6. Coverage and remaining gaps

| Surface | Status | Basis |
|---|---|---|
| `/ws/*` JAX-RS: IOETI, native `/ws/rest`, `/ws/action`, anonymous `/ws/public/*` | VERIFIED | live probe before/after, CI |
| Shiro/pac4j chain (`AxelorUserAuthorizer`, `AxelorLoginFilter`, `/callback`, `/logout`) | COVERED BY ORDERING | registration test, plus a live counter on non-JAX-RS routes. No failing-before live case: a blocked user's session is terminated, so the authorizer path could not be reached with a stale identity in the probe |
| Non-JAX-RS servlets (`/js/messages.js`, `/login`, `/index.html`) | VERIFIED (boundary executes) | live counter delta |
| Exception, cancelled and aborted requests | VERIFIED | unit tests, interleaved failures, client-aborted reload |
| Logout, then cookie reuse; blocked user | VERIFIED (refused under load) | live probe |
| Session expiry | NOT TESTED | the 60-minute timeout was not exercised; logout covers invalidation only |
| WebSocket message handlers | SOURCE_REVIEWED | handlers run on Tomcat threads outside servlet filters and bind a Shiro subject. In 8.2.5 the only handler that sets an identity (`MailChannel.isPermitted`) removes it in `finally`, and its async work uses an executor. Not live-tested |
| Background jobs, executors | SOURCE_REVIEWED | the boundary never runs on those threads (unit test). Upstream tasks apply their captured identity explicitly. Pollution needs a bound Shiro subject, which exists only on request and WebSocket threads. No live job test |
| Multi-node | NOT APPLICABLE (per JVM) | every node must run `ioeti-core` |

A finite clean run is evidence for this sample, not proof that no interleaving can leak.

## 7. Operational cautions and upgrade requirements

- Keep `ioeti-core` installed in every environment. Check the startup log for `SEC-001 request identity boundary installed before all other filters`. As admin, verify `/ws/ioeti/security/identity-boundary` reports `registered: true`.
- After every AOP, AOS or Tomcat upgrade:
  - run `scripts/ioeti.sh test` and check `RequestIdentityBoundaryIntegrationTest`;
  - run `scripts/identity_isolation_probe.py` against a disposable instance;
  - re-check §3 against the new sources (for example, whether `ContextState` changed, whether `web.xml` still declares only `guiceFilter`, and whether `AppContextListener` still builds the injector during `contextInitialized`).
- A non-zero `staleAtEntry` means something polluted a thread outside an HTTP request, for example a WebSocket handler. Treat it as a security incident and investigate.
