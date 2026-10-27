import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CircleDashed, ShieldCheck } from "lucide-react";
import { getPolicies, type PolicyOverview } from "./policiesApi";
import type { Language } from "./preferences";

/**
 * Day-one readiness for the people who can act on it: until a policy owner sets the business rules, the workflows that
 * need them are refused (fail closed). The card says how many rules are set, names the first missing ones and leads to the
 * rules page, where the recommended starting values can be applied. Nobody else sees it; it disappears once every rule is
 * set.
 */
const T = {
  ar: {
    title: "جاهزية التشغيل", noOwner: "لسه مفيش مسؤول عن قواعد العمل، فالخطوات اللي محتاجة قاعدة (الضريبة، الموافقات، التوزيع…) مقفولة.",
    noOwnerNext: "عيّن مسؤول قواعد (ممكن تكون إنت)، وبعدها يطبّق القيم الموصى بيها بضغطة ويعدّلها وقت ما يحب.",
    progress: (set: number, all: number) => `${set} من ${all} قاعدة متظبطة`, missing: "لسه ناقص:", more: (n: number) => `و${n} كمان`,
    go: "ظبط قواعد العمل", hint: "القيم الموصى بيها جاهزة في صفحة القواعد؛ مراجعتها وتطبيقها بياخدوا دقايق.",
  },
  en: {
    title: "Ready to run", noOwner: "Nobody owns the business rules yet, so the steps that need a rule (tax, approvals, routing…) are closed.",
    noOwnerNext: "Appoint a policy owner (it can be you); they can then apply the recommended values in one step and change them any time.",
    progress: (set: number, all: number) => `${set} of ${all} rules set`, missing: "Still missing:", more: (n: number) => `and ${n} more`,
    go: "Set the business rules", hint: "Recommended values are ready on the rules page; reviewing and applying them takes minutes.",
  },
};

export function SetupReadiness({ language, administrator, onNavigate }: { language: Language; administrator: boolean; onNavigate: (page: string) => void }) {
  const t = T[language], ar = language === "ar";
  const Forward = ar ? ArrowLeft : ArrowRight;
  const [overview, setOverview] = useState<PolicyOverview | null>(null);
  useEffect(() => { getPolicies().then(setOverview).catch(() => setOverview(null)); }, []);
  if (!overview) return null;
  const all = overview.policies.length, set = overview.policies.filter(p => p.inForce > 0).length;
  const ownerMissing = overview.noOwners && administrator;
  if (!ownerMissing && (!overview.canEdit || set === all)) return null;
  const missing = overview.policies.filter(p => p.inForce === 0);
  return <section className="setup-readiness" aria-label={t.title}>
    <div className="setup-readiness-head">
      <ShieldCheck size={20}/>
      <div><h2>{t.title}</h2><p>{ownerMissing ? t.noOwner : t.hint}</p></div>
      <button type="button" className="btn btn-primary" onClick={() => onNavigate("policies")}>{t.go}<Forward size={16}/></button>
    </div>
    {ownerMissing ? <p className="setup-readiness-next">{t.noOwnerNext}</p> : <>
      <div className="setup-readiness-meter" role="progressbar" aria-valuemin={0} aria-valuemax={all} aria-valuenow={set} aria-label={t.progress(set, all)}>
        <span style={{ width: `${Math.round((set / Math.max(1, all)) * 100)}%` }}/>
      </div>
      <p className="setup-readiness-count"><strong>{t.progress(set, all)}</strong></p>
      {missing.length > 0 && <p className="setup-readiness-missing"><CircleDashed size={14}/>{t.missing} {missing.slice(0, 4).map(p => ar ? p.titleAr : p.titleEn).join("، ")}
        {missing.length > 4 ? " " + t.more(missing.length - 4) : ""}</p>}
    </>}
  </section>;
}
