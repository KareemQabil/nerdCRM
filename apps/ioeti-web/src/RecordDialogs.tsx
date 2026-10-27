import { useEffect, useState, type FormEvent } from "react";
import { Building2, CircleAlert, LockKeyhole, Save } from "lucide-react";
import { ApiError, getCreatableBusinessLines, type AccountSummary, type BusinessLine, type ContactSummary, type LeadSummary } from "./api";
import { Dialog } from "./Dialog";
import { addContact, createAccount, editAccount, editLead, problem, similarAccounts } from "./dailyApi";
import { GovernorateOptions } from "./governorates";
import type { Language } from "./preferences";
import "./daily.css";

const L = {
  ar: {
    save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء", confirm: "تأكيد أنه سجل مختلف",
    keep: "اتركه فاضي علشان يفضل زي ما هو. القيمة الحالية لا تُعرض حفاظًا على الخصوصية.",
    editLead: "تعديل بيانات العميل المحتمل", governorate: "المحافظة", noGovernorate: "مش محددة", leadKicker: "العملاء المحتملون", fullName: "الاسم بالكامل", organization: "الجهة",
    phone: "هاتف جديد", email: "بريد إلكتروني جديد", line: "خط الأعمال", noLine: "بدون خط",
    newAccount: "حساب عميل جديد", editAccount: "تعديل الحساب", accountKicker: "حسابات العملاء", accountName: "اسم الشركة",
    website: "الموقع الإلكتروني", accountPhone: "هاتف الشركة", accountEmail: "بريد الشركة",
    accountHint: "يُضاف كعميل محتمل وياخد مرجع تلقائي. التليفون والبريد يُحفظوا ولا يُعرضوا في القوائم.",
    similar: "حسابات مشابهة موجودة", similarHint: "لو واحد منهم هو نفس الشركة افتحه بدل ما تكرر.", open: "فتح",
    duplicate: "في سجل مشابه. لو متأكد إنه مختلف، أكّد واحفظ.",
    addContact: "إضافة جهة اتصال", firstName: "الاسم الأول", lastName: "اسم العائلة", contactPhone: "الموبايل", contactEmail: "البريد الإلكتروني",
    contactHint: "تُربط بالحساب. بيانات التواصل تُحفظ ولا تُعرض في القوائم.",
  },
  en: {
    save: "Save", saving: "Saving…", cancel: "Cancel", confirm: "Confirm this is a different record",
    keep: "Leave empty to keep it as it is. The current value is not shown, for privacy.",
    editLead: "Edit lead details", governorate: "Governorate", noGovernorate: "Not given", leadKicker: "Leads", fullName: "Full name", organization: "Organization",
    phone: "New phone", email: "New e-mail", line: "Business line", noLine: "No line",
    newAccount: "New client account", editAccount: "Edit account", accountKicker: "Accounts", accountName: "Company name",
    website: "Website", accountPhone: "Company phone", accountEmail: "Company e-mail",
    accountHint: "Added as a prospect with an automatic reference. Phone and e-mail are kept, never shown in lists.",
    similar: "Similar accounts already exist", similarHint: "If one of them is the same company, open it instead of adding a copy.", open: "Open",
    duplicate: "A similar record exists. If you are sure this one is different, confirm and save.",
    addContact: "Add a contact person", firstName: "First name", lastName: "Last name", contactPhone: "Mobile", contactEmail: "E-mail",
    contactHint: "Linked to the account. Contact details are kept, never shown in lists.",
  },
} as const;

function isDuplicate(error: unknown) { return error instanceof ApiError && error.statusCode === 409 && error.code === "POSSIBLE_DUPLICATE"; }
const blank = (value: string) => value.trim() === "" ? undefined : value.trim();

export function EditLeadDialog({ lead, language, onClose, onSaved }: {
  lead: LeadSummary; language: Language; onClose: () => void; onSaved: (lead: LeadSummary) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [name, setName] = useState(lead.name);
  const [organization, setOrganization] = useState(lead.organization ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [line, setLine] = useState(lead.businessLineCode ?? "");
  const [governorate, setGovernorate] = useState(lead.governorate ?? "");
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getCreatableBusinessLines().then(setLines).catch(() => setLines([])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lead.version == null) return;
    setBusy(true); setError("");
    try {
      // one name field: the full name goes to the native last-name field and the first name is cleared
      const saved = await editLead(lead.id, lead.version, {
        firstName: "", name: name.trim(), organization: organization.trim(), phone: blank(phone), email: blank(email),
        ...(line !== (lead.businessLineCode ?? "") ? { businessLineCode: line } : {}),
        ...(governorate !== (lead.governorate ?? "") ? { governorate } : {}), confirmNotDuplicate: confirmed || undefined,
      });
      onSaved(saved);
    } catch (failure) {
      if (isDuplicate(failure)) setDuplicate(true);
      setError(problem(failure, ar));
    } finally { setBusy(false); }
  }
  return <Dialog title={l.editLead} kicker={l.leadKicker} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="edit-lead-form" className="btn btn-primary" disabled={busy || (duplicate && !confirmed)}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="edit-lead-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label><span>{l.fullName}</span><input value={name} required maxLength={255} onChange={e => setName(e.target.value)}/></label>
      <label><span>{l.organization}</span><input value={organization} maxLength={255} onChange={e => setOrganization(e.target.value)}/></label>
      <label><span>{l.phone}</span><input value={phone} inputMode="tel" dir="ltr" maxLength={20} onChange={e => setPhone(e.target.value)}/></label>
      <label><span>{l.email}</span><input type="email" value={email} dir="ltr" maxLength={255} onChange={e => setEmail(e.target.value)}/></label>
      <p className="daily-note daily-span"><LockKeyhole size={14}/>{l.keep}</p>
      {lines.length > 0 && <label className="daily-span"><span>{l.line}</span><select value={line} onChange={e => setLine(e.target.value)}>
        <option value="">{l.noLine}</option>{lines.map(x => <option key={x.code} value={x.code}>{ar ? x.nameAr || x.nameEn : x.nameEn || x.nameAr}</option>)}</select></label>}
      <label className="daily-span"><span>{l.governorate}</span><select value={governorate} onChange={e => setGovernorate(e.target.value)}>
        <GovernorateOptions ar={ar} none={l.noGovernorate}/></select></label>
      {duplicate && <label className="daily-confirm daily-span"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{l.confirm}</label>}
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{duplicate ? l.duplicate : error}</p>}
    </form>
  </Dialog>;
}

/** Add an account (with a live look for similar names) or edit one. */
export function AccountDialog({ account, language, onClose, onSaved }: {
  account?: AccountSummary; language: Language; onClose: () => void; onSaved: (account: AccountSummary) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [name, setName] = useState(account?.name ?? "");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [similar, setSimilar] = useState<AccountSummary[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = name.trim();
    if (value.length < 3 || value === account?.name) { setSimilar([]); return; }
    let current = true;
    const timer = window.setTimeout(() => void similarAccounts(value)
      .then(rows => { if (current) setSimilar(rows.filter(r => r.id !== account?.id)); }).catch(() => { if (current) setSimilar([]); }), 350);
    return () => { current = false; window.clearTimeout(timer); };
  }, [name, account?.id, account?.name]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const change = { name: name.trim(), website: blank(website), phone: blank(phone), email: blank(email), confirmNotDuplicate: confirmed || undefined };
      const saved = account ? await editAccount(account.id, account.version ?? 0, change) : await createAccount(change);
      onSaved(saved);
    } catch (failure) {
      if (isDuplicate(failure)) setDuplicate(true);
      setError(problem(failure, ar));
    } finally { setBusy(false); }
  }
  return <Dialog title={account ? l.editAccount : l.newAccount} description={account ? undefined : l.accountHint} kicker={l.accountKicker} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="account-form" className="btn btn-primary" disabled={busy || (duplicate && !confirmed)}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="account-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label className="daily-span"><span>{l.accountName}</span><input value={name} required minLength={2} maxLength={255} onChange={e => { setName(e.target.value); setDuplicate(false); setConfirmed(false); }}/></label>
      {similar.length > 0 && <div className="daily-similar daily-span" role="status"><strong><Building2 size={15}/>{l.similar}</strong><small>{l.similarHint}</small>
        <ul>{similar.slice(0, 5).map(s => <li key={s.id}><span>{s.name}</span><small dir="ltr">{s.reference}</small>
          <a className="text-action" href={"#/accounts/" + s.id} onClick={onClose}>{l.open}</a></li>)}</ul></div>}
      <label><span>{l.website}</span><input type="url" value={website} dir="ltr" maxLength={255} placeholder="https://" onChange={e => setWebsite(e.target.value)}/></label>
      <label><span>{l.accountPhone}</span><input value={phone} inputMode="tel" dir="ltr" maxLength={20} onChange={e => setPhone(e.target.value)}/></label>
      <label className="daily-span"><span>{l.accountEmail}</span><input type="email" value={email} dir="ltr" maxLength={255} onChange={e => setEmail(e.target.value)}/></label>
      {account && <p className="daily-note daily-span"><LockKeyhole size={14}/>{l.keep}</p>}
      {duplicate && <label className="daily-confirm daily-span"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{l.confirm}</label>}
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{duplicate ? l.duplicate : error}</p>}
    </form>
  </Dialog>;
}

export function ContactDialog({ account, language, onClose, onSaved }: {
  account: AccountSummary; language: Language; onClose: () => void; onSaved: (contact: ContactSummary) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      onSaved(await addContact(account.id, account.version ?? 0, { firstName: blank(firstName), name: lastName.trim(), phone: blank(phone), email: blank(email) }));
    } catch (failure) { setError(problem(failure, ar)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.addContact} description={l.contactHint} kicker={account.name} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="contact-form" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="contact-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label><span>{l.firstName}</span><input value={firstName} maxLength={255} onChange={e => setFirstName(e.target.value)}/></label>
      <label><span>{l.lastName}</span><input value={lastName} required maxLength={255} onChange={e => setLastName(e.target.value)}/></label>
      <label><span>{l.contactPhone}</span><input value={phone} inputMode="tel" dir="ltr" maxLength={20} onChange={e => setPhone(e.target.value)}/></label>
      <label><span>{l.contactEmail}</span><input type="email" value={email} dir="ltr" maxLength={255} onChange={e => setEmail(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
