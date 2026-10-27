import { useEffect, useState } from "react";
import { CircleAlert, Plus, Settings2 } from "lucide-react";
import { ApiError } from "./api";
import { addSource, getSources, type Option } from "./marketingApi";
import { getSystemReport, type SystemReport } from "./reportsApi";
import { usePreferences, type Language } from "./preferences";
import "./insights.css";

const strings = {
  ar: {
    title:"الإعدادات",sub:"تفضيلاتك، ومصادر العملاء المحتملين، وحالة النظام للمسؤولين.",
    prefs:"التفضيلات",language:"اللغة",theme:"المظهر",themes:{light:"فاتح",dark:"داكن",luxury:"فاخر"},
    sources:"مصادر العملاء المحتملين",addSource:"إضافة مصدر",name:"الاسم",none:"لا توجد مصادر",
    system:"حالة النظام",modules:"موديولات IOETI المثبتة",migrations:"ترحيلات قاعدة البيانات المطبقة",noLedger:"لم تُطبق ترحيلات على قاعدة البيانات هذه بعد.",
    policies:"قرارات السياسات",status:{OPEN:"مفتوح",SIGNED:"معتمد"},policyNote:"الإجراءات التي تعتمد على قرار مفتوح متوقفة في النظام (BLOCKED_BY_POLICY).",
    errors:{DUPLICATE:"هذا المصدر موجود.",REQUIRED:"الاسم مطلوب.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Settings",sub:"Your preferences, lead sources, and the system status for administrators.",
    prefs:"Preferences",language:"Language",theme:"Theme",themes:{light:"Light",dark:"Dark",luxury:"Luxury"},
    sources:"Lead sources",addSource:"Add source",name:"Name",none:"No sources",
    system:"System status",modules:"Installed IOETI modules",migrations:"Applied database migrations",noLedger:"No migrations were applied to this database yet.",
    policies:"Policy decisions",status:{OPEN:"Open",SIGNED:"Signed"},policyNote:"Actions that depend on an open decision are blocked in the system (BLOCKED_BY_POLICY).",
    errors:{DUPLICATE:"This source already exists.",REQUIRED:"The name is required.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields[0]?.code;
  if (code && (l.errors as Record<string, string>)[code]) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}

export function SettingsPage({language}:{language:Language}){
  const l=strings[language];
  const prefs=usePreferences();
  const [sources,setSources]=useState<Option[]>([]);
  const [name,setName]=useState("");
  const [system,setSystem]=useState<SystemReport|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    void getSources().then(setSources).catch(()=>{});
    void getSystemReport().then(setSystem).catch(()=>setSystem(null));
  },[]);
  async function add(){
    setError("");
    try{const created=await addSource(name);setSources(s=>[...s,created].sort((a,b)=>a.name.localeCompare(b.name)));setName("");}
    catch(e){setError(message(e,l));}
  }
  return <section className="page-enter st-page">
    <div className="page-title"><span className="eyebrow"><Settings2 size={14}/> IOETI</span><h1>{l.title}</h1><p>{l.sub}</p></div>
    <section className="rp-card" aria-labelledby="st-prefs"><h2 id="st-prefs">{l.prefs}</h2>
      <div className="mk-filters">
        <label><span>{l.language}</span><select value={prefs.language} onChange={e=>prefs.setLanguage(e.target.value as Language)}>
          <option value="ar">العربية</option><option value="en">English</option></select></label>
        <label><span>{l.theme}</span><select value={prefs.theme} onChange={e=>prefs.setTheme(e.target.value as keyof typeof l.themes)}>
          {(Object.keys(l.themes) as (keyof typeof l.themes)[]).map(t=><option key={t} value={t}>{l.themes[t]}</option>)}</select></label>
      </div>
    </section>
    <section className="rp-card" aria-labelledby="st-sources"><h2 id="st-sources">{l.sources}</h2>
      {sources.length===0?<p className="wf-muted">{l.none}</p>:<ul className="mk-tags">{sources.map(s=><li key={s.id}>{s.name}</li>)}</ul>}
      <form className="mk-inline" onSubmit={e=>{e.preventDefault();void add();}}>
        <label><span className="sr-only">{l.name}</span><input value={name} maxLength={255} placeholder={l.name} onChange={e=>setName(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={!name.trim()}><Plus size={15}/>{l.addSource}</button>
      </form>
      {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </section>
    {system&&<section className="rp-card" aria-labelledby="st-system"><h2 id="st-system">{l.system}</h2>
      <h3>{l.modules}</h3><ul className="mk-tags">{system.modules.map(m=><li key={m} dir="ltr">{m}</li>)}</ul>
      <h3>{l.migrations}</h3>{system.migrations===null||system.migrations.length===0?<p className="wf-muted">{l.noLedger}</p>:
        <div className="rp-scroll"><table className="rp-table"><tbody>{system.migrations.map(m=><tr key={m.version}><td dir="ltr">V{String(m.version).padStart(3,"0")}</td><td dir="ltr">{m.name}</td><td dir="ltr">{m.appliedOn?.slice(0,16)??"—"}</td></tr>)}</tbody></table></div>}
      <h3>{l.policies}</h3><div className="rp-scroll"><table className="rp-table"><tbody>{system.policies.map(p=><tr key={p.id}><td dir="ltr">{p.id}</td><td dir="ltr">{p.title}</td>
        <td><span className="wf-status">{(l.status as Record<string,string>)[p.status]??p.status}</span></td></tr>)}</tbody></table></div>
      <p className="wf-muted">{l.policyNote}</p>
    </section>}
  </section>;
}
