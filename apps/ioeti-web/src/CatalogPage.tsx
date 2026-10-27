import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, CircleAlert, Clock3, PackagePlus, Pencil, RefreshCw, Save, Search, Tag } from "lucide-react";
import { ApiError, type CatalogProduct } from "./api";
import { Dialog } from "./Dialog";
import {
  addService, changeService, getCategories, getManagedCatalog, getSellableCatalog, getUnits,
  type CatalogOption, type CatalogService, type ServiceInput,
} from "./catalogApi";
import type { Language } from "./preferences";
import "./daily.css";
import "./catalog.css";

const L = {
  ar: {
    eyebrow: "المبيعات", title: "كتالوج الخدمات", hint: "الخدمات اللي بتتباع وأسعارها قبل الضريبة. البائع بيختار منها في عرض السعر.",
    add: "خدمة جديدة", search: "ابحث بالاسم أو الكود", all: "الكل", onSale: "متاحة للبيع", offSale: "موقوفة", refresh: "تحديث",
    empty: "لسه مفيش خدمات في الكتالوج.", emptyManage: "ضيف أول خدمة: اسمها وكودها وسعرها قبل الضريبة.", noMatch: "مفيش نتايج للبحث ده.",
    loading: "جاري التحميل…", readOnly: "بتشوف الخدمات المتاحة للبيع بس، حسب صلاحياتك.",
    beforeTax: "قبل الضريبة", per: "لكل", edit: "تعديل",
    ready: "جاهزة للفوترة", pending: "إعداد الحسابات عند المالية",
    pendingHint: "حساب الإيراد والضرائب للشركة بيحددهم فريق المالية؛ لحد ما يتحددوا ممكن العرض يتوقف عند إعداد المبيعات.",
    newTitle: "خدمة جديدة", editTitle: "تعديل الخدمة", code: "الكود", name: "اسم الخدمة", summary: "وصف مختصر (اختياري)",
    type: "النوع", types: { service: "خدمة", storable: "منتج" }, unit: "وحدة البيع", noUnit: "بدون وحدة",
    price: "السعر قبل الضريبة", currency: "العملة", category: "التصنيف", noCategory: "بدون تصنيف",
    startDate: "متاحة من (اختياري)", endDate: "متاحة لحد (اختياري)", sale: "متاحة للبيع في عروض الأسعار",
    save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء", noTax: "لا يُحدد هنا أي ضريبة: الأسعار قبل الضريبة، والضرائب من إعداد المالية.",
    errors: { DUPLICATE: "الكود ده مستخدم لخدمة تانية.", REQUIRED: "الحقل ده مطلوب.", FORMAT: "الصيغة مش صحيحة.", RANGE: "السعر لازم يكون صفر أو أكتر، وبحد أقصى رقمين عشريين.",
      UNKNOWN: "العملة دي مش موجودة.", BEFORE_START: "تاريخ النهاية قبل البداية.", TOO_LONG: "النص طويل.", UNAVAILABLE: "اختيار غير متاح.",
      conflict: "الخدمة اتعدلت من مكان تاني. افتحها تاني.", forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب." },
    fields: { code: "الكود", name: "الاسم", salePrice: "السعر", currencyCode: "العملة", endDate: "تاريخ النهاية", startDate: "تاريخ البداية", summary: "الوصف", unitId: "الوحدة", categoryId: "التصنيف" },
  },
  en: {
    eyebrow: "Sales", title: "Service catalogue", hint: "What is sold and its price before tax. Sellers pick from it in quotations.",
    add: "New service", search: "Search by name or code", all: "All", onSale: "On sale", offSale: "Off sale", refresh: "Refresh",
    empty: "The catalogue is empty.", emptyManage: "Add the first service: its name, code and price before tax.", noMatch: "Nothing matches this search.",
    loading: "Loading…", readOnly: "You see the services on sale only, as your permissions allow.",
    beforeTax: "before tax", per: "per", edit: "Edit",
    ready: "Ready to invoice", pending: "Accounting set-up with finance",
    pendingHint: "The company's revenue account and taxes are set by finance; until then a quotation may stop at the sales set-up.",
    newTitle: "New service", editTitle: "Edit service", code: "Code", name: "Service name", summary: "Short summary (optional)",
    type: "Type", types: { service: "Service", storable: "Product" }, unit: "Sold per", noUnit: "No unit",
    price: "Price before tax", currency: "Currency", category: "Category", noCategory: "No category",
    startDate: "Available from (optional)", endDate: "Available until (optional)", sale: "On sale in quotations",
    save: "Save", saving: "Saving…", cancel: "Cancel", noTax: "No tax is set here: prices are before tax, and taxes come from finance's set-up.",
    errors: { DUPLICATE: "Another service already has this code.", REQUIRED: "This field is required.", FORMAT: "The format is not valid.", RANGE: "Use zero or more, with at most two decimals.",
      UNKNOWN: "This currency does not exist.", BEFORE_START: "The end date is before the start date.", TOO_LONG: "The text is too long.", UNAVAILABLE: "This choice is not available.",
      conflict: "The service changed elsewhere. Open it again.", forbidden: "You are not allowed to do this.", failed: "The request failed." },
    fields: { code: "Code", name: "Name", salePrice: "Price", currencyCode: "Currency", endDate: "End date", startDate: "Start date", summary: "Summary", unitId: "Unit", categoryId: "Category" },
  },
};
type Labels = typeof L.ar;
type Filter = "all" | "on" | "off";

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  const f = error.fields?.[0];
  if (f) return `${(l.fields as Record<string, string>)[f.field] ?? f.field}: ${(l.errors as Record<string, string>)[f.code] ?? f.code}`;
  return l.errors.failed;
}

/** One row of either view: managers see every field, sellers the services on sale. */
type Card = { id: number; code: string | null; name: string; unit: string | null; salePrice: string | number | null; currency: string | null;
  summary?: string | null; onSale?: boolean; accountingReady?: boolean; category?: string | null; full?: CatalogService };

export function CatalogPage({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [cards, setCards] = useState<Card[] | null>(null);
  const [manage, setManage] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CatalogService | "new" | null>(null);
  const load = useCallback(async (search: string) => {
    setError("");
    try {
      const rows = await getManagedCatalog(search);
      setManage(true);
      setCards(rows.map(s => ({ id: s.id, code: s.code, name: s.name, unit: s.unit, salePrice: s.salePrice, currency: s.currencyCode, summary: s.summary,
        onSale: s.onSale, accountingReady: s.accountingReady, category: s.category, full: s })));
    } catch (e) {
      if (!(e instanceof ApiError && e.statusCode === 403)) { setError(problem(e, l)); setCards([]); return; }
      // not allowed to manage: the services on sale, as in quotations
      try {
        const rows: CatalogProduct[] = await getSellableCatalog(search);
        setManage(false);
        setCards(rows.map(p => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, salePrice: p.salePrice, currency: p.currency })));
      } catch (inner) { setError(problem(inner, l)); setCards([]); }
    }
  }, [l]);
  useEffect(() => { const t = window.setTimeout(() => void load(q), 250); return () => window.clearTimeout(t); }, [q, load]);
  const shown = (cards ?? []).filter(c => filter === "all" || (filter === "on" ? c.onSale !== false : c.onSale === false));
  const money = (value: string | number | null, currency: string | null) => value == null ? "—"
    : new Intl.NumberFormat(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 }).format(Number(value)) + (currency ? " " + currency : "");
  return <section className="page-enter catalog-page">
    <div className="page-head">
      <div className="page-title"><span className="eyebrow">{l.eyebrow}</span><h1>{l.title}</h1><p>{l.hint}</p></div>
      {manage && <div className="page-head-actions"><button type="button" className="btn btn-primary" onClick={() => setEditing("new")}><PackagePlus size={16}/>{l.add}</button></div>}
    </div>
    <div className="catalog-toolbar">
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.search}</span><input value={q} maxLength={80} placeholder={l.search} onChange={e => setQ(e.target.value)}/></label>
      {manage && <div className="segmented" role="group">{(["all", "on", "off"] as Filter[]).map(f =>
        <button key={f} type="button" className={filter === f ? "chosen" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? l.all : f === "on" ? l.onSale : l.offSale}</button>)}</div>}
      <button type="button" className="icon-button" aria-label={l.refresh} onClick={() => void load(q)}><RefreshCw size={18}/></button>
    </div>
    {!manage && cards !== null && <p className="catalog-note">{l.readOnly}</p>}
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span></div>}
    {cards === null ? <div className="empty-state" role="status">{l.loading}</div>
      : shown.length === 0 ? <div className="empty-state catalog-empty"><Tag size={30}/><strong>{q ? l.noMatch : l.empty}</strong>{!q && manage && <span>{l.emptyManage}</span>}</div>
      : <ul className="catalog-grid">{shown.map(c => <li key={c.id} className={"catalog-card" + (c.onSale === false ? " is-off" : "")}>
        <div className="catalog-card-top">
          <span className="catalog-code" dir="ltr">{c.code || "—"}</span>
          {c.onSale === false && <span className="catalog-pill is-off">{l.offSale}</span>}
          {c.category && <span className="catalog-pill">{c.category}</span>}
        </div>
        <strong className="catalog-name">{c.name}</strong>
        {c.summary && <p className="catalog-summary">{c.summary}</p>}
        <div className="catalog-price"><b>{money(c.salePrice, c.currency)}</b><small>{l.beforeTax}{c.unit ? ` · ${l.per} ${c.unit}` : ""}</small></div>
        {manage && <div className="catalog-card-foot">
          {c.accountingReady ? <span className="catalog-ready"><BadgeCheck size={14}/>{l.ready}</span>
            : <span className="catalog-pending" title={l.pendingHint}><Clock3 size={14}/>{l.pending}</span>}
          <button type="button" className="btn btn-secondary btn-small" aria-label={`${l.edit}: ${c.name}`} onClick={() => c.full && setEditing(c.full)}><Pencil size={14}/>{l.edit}</button>
        </div>}
      </li>)}</ul>}
    {editing && <ServiceDialog l={l} service={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); void load(q); }}/>}
  </section>;
}

function ServiceDialog({ l, service, onClose, onSaved }: { l: Labels; service: CatalogService | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(service?.code ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [summary, setSummary] = useState(service?.summary ?? "");
  const [type, setType] = useState<"service" | "storable">(service?.type ?? "service");
  const [unitId, setUnitId] = useState(service?.unitId ? String(service.unitId) : "");
  const [price, setPrice] = useState(service?.salePrice != null ? String(Number(service.salePrice)) : "");
  const [currency, setCurrency] = useState(service?.currencyCode ?? "EGP");
  const [categoryId, setCategoryId] = useState(service?.categoryId ? String(service.categoryId) : "");
  const [onSale, setOnSale] = useState(service?.onSale ?? true);
  const [startDate, setStartDate] = useState(service?.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(service?.endDate?.slice(0, 10) ?? "");
  const [units, setUnits] = useState<CatalogOption[]>([]);
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void getUnits().then(setUnits).catch(() => setUnits([]));
    void getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const input: ServiceInput = {
      code: code.trim(), name: name.trim(), summary: summary.trim(), type, unitId: unitId ? Number(unitId) : "", salePrice: price.trim(),
      currencyCode: currency.trim().toUpperCase(), categoryId: categoryId ? Number(categoryId) : "", onSale, startDate, endDate,
    };
    try {
      if (service) await changeService(service.id, service.version, input); else await addService(input);
      onSaved();
    } catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={service ? l.editTitle : l.newTitle} kicker={l.title} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="service-form" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="service-form" className="daily-form daily-form-two catalog-form" onSubmit={e => void submit(e)}>
      <label><span>{l.name}</span><input value={name} required maxLength={255} onChange={e => setName(e.target.value)}/></label>
      <label><span>{l.code}</span><input value={code} required dir="ltr" maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,29}" placeholder="ISO-AUDIT-DAY"
        onChange={e => setCode(e.target.value.toUpperCase())}/></label>
      <label className="daily-span"><span>{l.summary}</span><textarea value={summary} maxLength={2000} rows={2} onChange={e => setSummary(e.target.value)}/></label>
      <div className="catalog-price-row daily-span">
        <label><span>{l.price}</span><input value={price} required inputMode="decimal" dir="ltr" pattern="\d{1,12}(\.\d{1,2})?" placeholder="4500" onChange={e => setPrice(e.target.value)}/></label>
        <label><span>{l.currency}</span><input value={currency} required dir="ltr" maxLength={3} pattern="[A-Za-z]{3}" onChange={e => setCurrency(e.target.value.toUpperCase())}/></label>
        <label><span>{l.unit}</span><select value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">{l.noUnit}</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      </div>
      <p className="daily-note daily-span">{l.noTax}</p>
      <div className="daily-span catalog-type"><span>{l.type}</span><div className="segmented" role="group">
        {(["service", "storable"] as const).map(t => <button key={t} type="button" className={type === t ? "chosen" : ""} aria-pressed={type === t} onClick={() => setType(t)}>{l.types[t]}</button>)}
      </div></div>
      <label><span>{l.category}</span><select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">{l.noCategory}</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="catalog-switch"><input type="checkbox" checked={onSale} onChange={e => setOnSale(e.target.checked)}/><span>{l.sale}</span></label>
      <label><span>{l.startDate}</span><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}/></label>
      <label><span>{l.endDate}</span><input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
