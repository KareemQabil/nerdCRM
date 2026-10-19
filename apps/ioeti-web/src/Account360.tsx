import { useEffect, useState } from "react";
import { CircleAlert, CircleDashed } from "lucide-react";
import { getAccountContacts, getAccountOpportunities, type ContactSummary, type Opportunity } from "./api";
import type { Language } from "./preferences";

const strings = {
  ar: {
    contacts:"جهات الاتصال",opportunities:"الفرص التجارية",loading:"جار التحميل...",
    noContacts:"لا توجد جهات اتصال مسموح لك برؤيتها لهذا الحساب",
    noOpportunities:"لا توجد فرص ضمن نطاق صلاحياتك لهذا الحساب",
    failed:"تعذّر تحميل السجلات المرتبطة",open:"فتح",tabs:"سجلات الحساب المرتبطة",
  },
  en: {
    contacts:"Contacts",opportunities:"Opportunities",loading:"Loading...",
    noContacts:"No contacts you may see for this account",
    noOpportunities:"No opportunities in your scope for this account",
    failed:"Could not load related records",open:"Open",tabs:"Account related records",
  },
} as const;
type Tab = "contacts" | "opportunities";

/** Account 360 related tabs; every list is filtered by the server with the caller's permissions. */
export function Account360({accountId,language}:{accountId:number;language:Language}){
  const l=strings[language];
  const [tab,setTab]=useState<Tab>("opportunities");
  const [contacts,setContacts]=useState<ContactSummary[]|null>(null);
  const [opportunities,setOpportunities]=useState<Opportunity[]|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let current=true;
    setContacts(null);setOpportunities(null);setError(false);
    Promise.all([getAccountContacts(accountId),getAccountOpportunities(accountId)])
      .then(([c,o])=>{if(current){setContacts(c);setOpportunities(o);}})
      .catch(()=>{if(current)setError(true);});
    return()=>{current=false;};
  },[accountId]);
  const rows=tab==="contacts"
    ?(contacts||[]).map(c=>({id:c.id,title:c.name,detail:c.jobTitle||"—",href:null as string|null}))
    :(opportunities||[]).map(o=>({id:o.id,title:o.name,detail:[o.reference,o.businessLineCode,o.stage].filter(Boolean).join(" · ")||"—",href:"#/opportunities/"+o.id}));
  const loading=contacts===null&&!error;
  return <div className="account-360">
    <div className="demo-record-tabs" role="tablist" aria-label={l.tabs}>
      {(["opportunities","contacts"] as const).map(key=><button key={key} type="button" role="tab" id={"account-tab-"+key}
        aria-controls="account-related-panel" aria-selected={tab===key} tabIndex={tab===key?0:-1}
        className={tab===key?"active":""} onClick={()=>setTab(key)}>
        {l[key]}{key==="contacts"&&contacts?` (${contacts.length})`:key==="opportunities"&&opportunities?` (${opportunities.length})`:""}
      </button>)}
    </div>
    <div role="tabpanel" id="account-related-panel" aria-labelledby={"account-tab-"+tab} tabIndex={0}>
      {error?<div className="login-error" role="alert"><CircleAlert size={17}/>{l.failed}</div>
      :loading?<div className="empty-state" role="status">{l.loading}</div>
      :rows.length===0?<div className="record-related-empty"><CircleDashed size={28}/><strong>{tab==="contacts"?l.noContacts:l.noOpportunities}</strong></div>
      :<div className="directory-items">{rows.map(row=><article className="directory-item" key={row.id}>
        <div className="line-monogram">{row.title.trim().slice(0,1).toLocaleUpperCase()}</div>
        <div className="directory-record"><strong>{row.title}</strong><small>{row.detail}</small></div>
        {row.href&&<a className="text-action" href={row.href}>{l.open}</a>}
      </article>)}</div>}
    </div>
  </div>;
}
