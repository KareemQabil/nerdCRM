import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { ApiError } from "./api";
import { confirmMfa, disableMfa, getMfa, newRecoveryCodes, startMfa, type MfaSetup, type MfaStatus } from "./mfaApi";
import type { Language } from "./preferences";

const L = {
  ar: {
    title: "الدخول بخطوتين", hint: "اختياري (D-07). بعد تفعيله، الدخول بيطلب كلمة المرور وكود من تطبيق المصادقة على موبايلك.",
    on: "مفعّل بتطبيق مصادقة.", off: "مش مفعّل.", start: "تفعيل بتطبيق مصادقة", scan: "امسح الكود بتطبيق المصادقة (Google Authenticator أو Microsoft Authenticator أو غيرهم)، أو اكتب المفتاح بإيدك:",
    secret: "المفتاح", code: "الكود من التطبيق", confirm: "تأكيد وتفعيل", cancel: "إلغاء",
    codes: "أكواد الاسترجاع", codesHint: "احفظها في مكان آمن. كل كود بيتستخدم مرة واحدة لو الموبايل مش معاك. مش هتظهر تاني.",
    done: "تمام، حفظتها", turnOff: "إيقاف الدخول بخطوتين", regenerate: "أكواد استرجاع جديدة", useRecovery: "استخدم كود استرجاع بدل التطبيق",
    currentCode: "كود حالي للتأكيد", apply: "تأكيد",
    errors: { INVALID: "الكود مش مطابق. استخدم الكود الحالي من التطبيق.", REQUIRED: "اكتب الكود.", failed: "تعذّر تنفيذ الطلب." } as Record<string, string>,
  },
  en: {
    title: "Two-step sign-in", hint: "Optional (D-07). Once on, signing in asks for your password and a code from an authenticator app on your phone.",
    on: "On, with an authenticator app.", off: "Off.", start: "Turn on with an authenticator app", scan: "Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator or similar), or type the key:",
    secret: "Key", code: "Code from the app", confirm: "Confirm and turn on", cancel: "Cancel",
    codes: "Recovery codes", codesHint: "Keep them somewhere safe. Each works once if you do not have your phone. They are not shown again.",
    done: "Done, I saved them", turnOff: "Turn off two-step sign-in", regenerate: "New recovery codes", useRecovery: "Use a recovery code instead of the app",
    currentCode: "A current code to confirm", apply: "Confirm",
    errors: { INVALID: "The code does not match. Use the current code from the app.", REQUIRED: "Enter the code.", failed: "The request failed." } as Record<string, string>,
  },
} as const;

type Pending = "off" | "regenerate" | null;

/** The signed-in person's own two-step sign-in: set up, recovery codes, turn off. */
export function MfaSettings({ language }: { language: Language }) {
  const l = L[language];
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getMfa().then(setStatus).catch(() => setStatus(null)); }, []);
  const fail = (e: unknown) => setError(e instanceof ApiError ? (l.errors[e.fields?.[0]?.code ?? ""] ?? l.errors.failed) : l.errors.failed);
  async function run(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function reset() { setCode(""); setRecovery(false); setPending(null); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (setup) return run(async () => { const r = await confirmMfa(code); setStatus(r.status); setCodes(r.recoveryCodes); setSetup(null); reset(); });
    if (pending === "off") return run(async () => { setStatus(await disableMfa(code, recovery)); reset(); });
    if (pending === "regenerate") return run(async () => { const r = await newRecoveryCodes(code, recovery); setCodes(r.recoveryCodes); reset(); });
  }
  if (!status) return null;
  return <section className="rp-card mfa-card" aria-labelledby="st-mfa"><h2 id="st-mfa"><KeyRound size={18}/>{l.title}</h2>
    <p className="wf-muted">{l.hint}</p>
    <p className={"mfa-state" + (status.enabled ? " is-on" : "")} role="status">{status.enabled ? <ShieldCheck size={16}/> : <ShieldOff size={16}/>}{status.enabled ? l.on : l.off}</p>
    {codes && <div className="mfa-codes" role="region" aria-label={l.codes}><strong>{l.codes}</strong><p className="wf-muted">{l.codesHint}</p>
      <ol dir="ltr">{codes.map(c => <li key={c}><code>{c}</code></li>)}</ol>
      <button type="button" className="btn btn-secondary" onClick={() => setCodes(null)}>{l.done}</button></div>}
    {!status.enabled && !setup && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => setSetup(await startMfa()))}>{l.start}</button>}
    {status.enabled && !pending && !codes && <div className="mfa-actions">
      <button type="button" className="btn btn-secondary" onClick={() => setPending("regenerate")}>{l.regenerate}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setPending("off")}>{l.turnOff}</button></div>}
    {(setup || pending) && <form className="mfa-form" onSubmit={e => void submit(e)}>
      {setup && <><p>{l.scan}</p><img className="mfa-qr" src={setup.qrCode} alt={l.secret + ": " + setup.secret} width={180} height={180}/>
        <p className="mfa-secret">{l.secret}: <code dir="ltr">{setup.secret}</code></p></>}
      <label><span>{setup ? l.code : l.currentCode}</span><input value={code} onChange={e => setCode(e.target.value)} required inputMode={recovery ? "text" : "numeric"}
        autoComplete="one-time-code" dir="ltr" maxLength={40}/></label>
      {pending && <label className="mfa-recovery"><input type="checkbox" checked={recovery} onChange={e => setRecovery(e.target.checked)}/>{l.useRecovery}</label>}
      <div className="mfa-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{setup ? l.confirm : l.apply}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setSetup(null); reset(); }}>{l.cancel}</button></div>
    </form>}
    {error && <p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
  </section>;
}
