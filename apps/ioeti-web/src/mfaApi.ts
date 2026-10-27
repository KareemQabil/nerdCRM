import { wrapped } from "./api";

/** D-07: optional multi-factor sign-in (native Axelor TOTP), self-service. The server checks every step. */
export type MfaStatus = { enabled: boolean; method: "TOTP" | null };
export type MfaSetup = { secret: string; qrCode: string };
export type MfaEnabled = { status: MfaStatus; recoveryCodes: string[] };

// the shared request adds the CSRF token to unsafe methods
const post = <T,>(path: string, body: Record<string, unknown> = {}) =>
  wrapped<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getMfa = () => wrapped<MfaStatus>("/ws/ioeti/me/mfa");
export const startMfa = () => post<MfaSetup>("/ws/ioeti/me/mfa/start");
export const confirmMfa = (code: string) => post<MfaEnabled>("/ws/ioeti/me/mfa/confirm", { code });
export const disableMfa = (code: string, recovery: boolean) => post<MfaStatus>("/ws/ioeti/me/mfa/disable", { code, recovery });
export const newRecoveryCodes = (code: string, recovery: boolean) => post<MfaEnabled>("/ws/ioeti/me/mfa/recovery-codes", { code, recovery });
export const resetMfa = (userId: number) => post<MfaStatus>(`/ws/ioeti/admin/users/${userId}/mfa/reset`);
