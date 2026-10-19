# SEC-004 (part 1): sessions, cookies, CSRF, logout, expiry, login throttling

Gaps: **G-005** (sessions/CSRF/brute force), part of **G-014** (environment configuration). Issue #13.

Status: **LIVE_INTEGRATION_PASS** and **NEGATIVE_SECURITY_PASS** for the items below.

Not done:
- MFA (policy D-07);
- secret vault and production provisioning (D-08);
- structural isolation of sensitive fields (G-007).

## 1. What AOP 8.2.5 already does (source-verified, then tested live)

| Control | Source | Live result |
|---|---|---|
| Session id rotated at login | Shiro/pac4j callback | ✅ new `JSESSIONID` after login |
| Session cookie flags | `AxelorSessionManager`, Tomcat | ✅ `HttpOnly`, `SameSite=Lax` over HTTP. Over HTTPS Axelor uses `SameSite=None` + `Secure` |
| CSRF | `AxelorCsrfAuthorizer` / `AxelorCsrfMatcher`: cookie `CSRF-TOKEN` (readable), header `X-CSRF-Token` | ✅ write with `Origin` and no token → 403; forged token → 403; real token → success; GET needs no token |
| Logout invalidates the server session | `AxelorLogoutFilter` | ✅ old cookie → 401 on session and data endpoints |
| Session timeout | `session.timeout` (minutes; Shiro session and cache expiry) | ✅ idle session → 401 after the timeout; an active one survives |
| Brute-force protection | **none** in AOP 8.2.5 or AOS 9.1.10 | added by IOETI (§3) |

**CSRF scope.** pac4j checks CSRF **only for requests carrying an `Origin` header** (`AuthPac4jInfo.isNativeClient` = "no `Origin`"). Browsers always send `Origin` on cross-site POST/PUT, so cross-site forgery is refused. Non-browser API clients are exempt by design.

## 2. Real-mode bug found and fixed in the custom UI

`apps/ioeti-web/src/api.ts` never sent `X-CSRF-Token`. In a real browser, opportunity **create and rename were therefore refused (403)**. The mocked browser tests and the Python pilot could not see this: the first has no server, and the second sends no `Origin`.

Fixes:
- `api.ts` reads the `CSRF-TOKEN` cookie and sends `X-CSRF-Token` on every non-GET/HEAD request.
- A latent header-merge bug is fixed: `...options` used to overwrite `Accept`.

New UI features:
- a real-mode **sign-out** control in the top bar, which calls `/logout` and returns to sign-in;
- a localized "too many attempts" message when sign-in answers 429.

## 3. IOETI login throttling (`LoginThrottleFilter`)

Registered on `/callback` right behind the SEC-001 identity boundary, before Shiro/pac4j.

How it works:
- It counts failed logins (pac4j's 401/403 response) in a sliding window, keyed per **address** and per **username + address**.
- While a key is over its limit, it answers **429** with `Retry-After` and the IOETI error contract, *before* credentials are checked.
- A successful login clears that username's count, never the address's.
- There is deliberately no per-username limit across all addresses: anyone could use it to lock out a known user.

| Setting (env: `AXELOR_CONFIG_` + key with `_`) | Default |
|---|---|
| `ioeti.security.login.window` (minutes) | 15 |
| `ioeti.security.login.ip.max` | 20 |
| `ioeti.security.login.user.max` | 5 |
| `ioeti.security.trusted.proxies` (addresses whose `X-Forwarded-For` is trusted) | none |

The defaults are engineering defaults; the owner may change them (D-07).

Limitations:
- **Counters are per JVM.** A multi-node deployment needs a shared store or throttling at the reverse proxy.
- Behind a reverse proxy, configure `trusted.proxies`. Otherwise every client shares the proxy's address and limit.

## 4. Production configuration (must be set; see `infra/axelor/axelor-config.ioeti.template.properties`)

- `session.cookie.secure = true` and HTTPS only. Axelor then marks the session and CSRF cookies `Secure`.
- `session.timeout` as approved by the owner (D-07). The dev default is 60.
- No CORS origins (`cors.allow.origin` unset) unless a reviewed cross-origin deployment needs one.
- `ioeti.security.trusted.proxies` set to the real proxy addresses only.

## 5. Evidence (local Axelor 9.1.10 + PostgreSQL 16; also in backend CI)

| Probe | Result |
|---|---|
| `scripts/session_security_probe.py` (main job) | **20/20**. Fixtures are least-privilege; cleanup is complete (tracking messages are removed; an undeletable user would be blocked and de-grouped, and reported) |
| `scripts/session_security_probe.py --expiry` (separate CI job: `AXELOR_CONFIG_SESSION_TIMEOUT=1`, window 1 min, 4 failures per address) | **6/6**: idle expiry, active survival, address throttle and its release |
| Regression on this branch | pilot PASS, two-writer 13/13, contract 31/31, smoke 16/16, identity 0 leaks / 325,817 checks |
| JUnit | 47/47 (+6 `LoginThrottleFilterTest`) |
| Web | build passes; mocked browser 21/21 (+3: CSRF header, sign-out, 429 message); demo 14/14 |
