# P4b: optional two-step sign-in (D-07)

D-07 (signed 2026-10-25) says: **MFA is optional** (users may turn it on).

## What is used

The **native Axelor MFA** (axelor-core 8.2.5):
- `MFAService`;
- the `auth_mfa` table;
- the sign-in callback's `/mfa` step.

It uses TOTP authenticator apps (RFC 6238: SHA-1, 6 digits, 30 seconds) and one-time recovery codes. Nothing in the
authentication itself is re-implemented. The platform adds a self-service API for its own screens, and an administrator reset.

**E-mail codes are not offered:** sending e-mail from the platform is a D-10 channel.

## Turning it on (Settings › Two-step sign-in)

1. **Start:** a new key and its QR code. MFA is not yet on.
2. **Confirm with a code from the app:**
   - Only then is MFA turned on (`MFA_ENABLED`).
   - Recovery codes are shown **once**.
   - A wrong code leaves it off.
3. **New recovery codes, or turning it off:** these need a **current code**, from the app or a recovery code (which is used up).

## Signing in

| Step | Request | Answer |
|---|---|---|
| 1 | `POST /callback {username, password}` | No session; the callback answers with the `/mfa` route |
| 2 | `POST /callback {username, mfaCode, mfaMethod: TOTP or RECOVERY}` | A session, or the code step again for a wrong code |

The sign-in screen:
- asks for the code;
- explains a wrong one;
- has "I do not have my phone: use a recovery code".

A recovery code works once.

## Lost device

An administrator resets the person's MFA:
- `POST /ws/ioeti/admin/users/{id}/mfa/reset`, audited as `MFA_RESET`.
- The person then signs in with their password and can turn MFA on again.
- Nobody else can reset it (`403`). Resetting what is off answers `422 MFA_NOT_ON`.

## Audit

Events in the admin change log, subject `USER`:
- `MFA_ENABLED`
- `MFA_RECOVERY_CODES`
- `MFA_DISABLED`
- `MFA_RESET`

No key or code is written there. The key, the QR code and the codes are classified `RESTRICTED` in the PII registry.

## API (`/ws/ioeti`)

| Method | Path | Body |
|---|---|---|
| `GET` | `/me/mfa` | — → `{enabled, method}` |
| `POST` | `/me/mfa/start` | — → `{secret, qrCode}` (a PNG data URL) |
| `POST` | `/me/mfa/confirm` | `{code}` → `{status, recoveryCodes}` |
| `POST` | `/me/mfa/recovery-codes` | `{code, recovery}` → `{status, recoveryCodes}` |
| `POST` | `/me/mfa/disable` | `{code, recovery}` |
| `POST` | `/admin/users/{id}/mfa/reset` | — (administrators) |

## Tests

- **`scripts/mfa_probe.py` (backend CI):** live checks with a real TOTP computed by the probe, covering set-up, sign-in with
  the app's code and with a recovery code (once), turning off, new codes, the reset, and the audit without secrets.
- **Mocked browser tests:**
  - the sign-in code step: wrong code, then a recovery code, with the exact callback bodies;
  - the Settings flow: wrong code, then the right one, recovery codes shown once, turning off with a recovery code.
