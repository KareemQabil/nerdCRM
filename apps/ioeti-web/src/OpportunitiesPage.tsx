import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Plus, RefreshCw, Save, Search, ShieldCheck, X } from "lucide-react";
import {
  ApiError, createOpportunity, getCreatableBusinessLines, getOpportunities, getOpportunity, renameOpportunity,
  type BusinessLine, type Opportunity,
} from "./api";
import { type Language } from "./preferences";
import { OpportunityRecordWorkspace } from "./OpportunityRecordWorkspace";
import { ErrorBanner, PageHeader } from "./ui";
import { problem } from "./dailyApi";
import { DataTable, tableLabels } from "./DataTable";
import { amount, day, quantity } from "./format";
import { stageLabel } from "./labels";

type Labels = Record<string, string>;
type Props = { language: Language; lines: BusinessLine[]; labels: Labels };
type Mode = { type: "create" } | { type: "rename"; item: Opportunity };

export function OpportunitiesPage({ language, labels }: Props) {
  const [items, setItems] = useState<Opportunity[]>([]);
  // SEC-003: the create form offers only lines the server allows this user to sell in
  const [creatable, setCreatable] = useState<BusinessLine[] | null>(null);
  const [selected,setSelected] = useState<Opportunity|null>(null);
  const [detailLoading,setDetailLoading] = useState(false);
  const listScroll = useRef(0);
  const focusReturn = useRef<HTMLButtonElement|null>(null);
  const returning = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState("");
  const [businessLineCode, setBusinessLineCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const isRTL = language === "ar";
  const line = (item: Opportunity) => (isRTL ? item.businessLineNameAr : item.businessLineNameEn) || item.businessLineCode;
  const arrow = isRTL ? <ArrowLeft size={17} /> : <ArrowRight size={17}/>;

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const values = await getOpportunities(0, 25);
      setItems(values);
      setMore(values.length === 25);
    } catch (reason) {
      setError(problem(reason, isRTL));
    } finally { setLoading(false); }
  }, [labels.unavailable]);

  useEffect(() => { void reload(); }, [reload]);
  // A real record URL and browser history; global module navigation is unchanged.
  useEffect(() => {
    let generation = 0;
    const sync = () => {
      const current = ++generation;
      const match = window.location.hash.match(/^#\/opportunities\/(\d+)$/);
      if (!match) { setSelected(null); return; }
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id) || id <= 0) { setSelected(null); return; }
      setDetailLoading(true); setError("");
      void getOpportunity(id).then(record => {
        if (current === generation) setSelected(record);
      }).catch(reason => {
        if (current === generation) {
          setSelected(null);
          setError(reason instanceof ApiError && reason.statusCode === 403
            ? labels.forbidden : problem(reason, isRTL));
        }
      }).finally(() => {
        if (current === generation) setDetailLoading(false);
      });
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      generation++;
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [labels.forbidden, labels.unavailable]);

  useEffect(() => {
    if (selected) { returning.current = true; return; }
    if (returning.current) {
      returning.current = false;
      requestAnimationFrame(() => {
        window.scrollTo({top:listScroll.current,behavior:"instant"});
        focusReturn.current?.focus();
      });
    }
  }, [selected]);

  async function openRecord(id: number, source?: HTMLButtonElement) {
    if (source) focusReturn.current = source;
    if (!selected) listScroll.current = window.scrollY;
    setDetailLoading(true); setError("");
    try {
      const record = await getOpportunity(id);
      const route = "#/opportunities/" + id;
      if (window.location.hash !== route)
        window.history.pushState({ioetiOpportunityDetail:true,id},"",route);
      setSelected(record);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.statusCode === 403
        ? labels.forbidden : problem(reason, isRTL));
    } finally { setDetailLoading(false); }
  }
  function backToList() {
    if (window.history.state?.ioetiOpportunityDetail) window.history.back();
    else {
      window.history.replaceState(null,"","#/opportunities");
      setSelected(null);
    }
  }

  useEffect(() => {
    if (!mode) return;
    inputRef.current?.focus();
    return () => { previousFocus.current?.focus(); };
  }, [mode]);

  function onDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!saving) setMode(null);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(node => node.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function openCreate(event: React.MouseEvent<HTMLButtonElement>) {
    previousFocus.current = event.currentTarget;
    setName(""); setBusinessLineCode(""); setCreatable(null);
    setFormError(""); setMode({ type: "create" });
    void getCreatableBusinessLines()
      .then(values => { setCreatable(values); setBusinessLineCode(values[0]?.code || ""); })
      .catch(() => { setCreatable([]); setFormError(labels.unavailable); });
  }
  function openRename(source: HTMLButtonElement | null, item: Opportunity) {
    previousFocus.current = source;
    setName(item.name); setBusinessLineCode(item.businessLineCode || "");
    setFormError(""); setMode({ type: "rename", item });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || saving) return;
    if (name.trim().length < 3 || name.trim().length > 160) {
      setFormError(labels.invalidName); return;
    }
    setSaving(true); setFormError("");
    try {
      if (mode.type === "create") {
        if (!businessLineCode) { setFormError(labels.chooseLine); return; }
        await createOpportunity(name.trim(), businessLineCode);
      } else {
        const updated = await renameOpportunity(mode.item.id, name.trim(), mode.item.version);
        if (selected?.id === updated.id) setSelected(updated);
      }
      setMode(null);
      await reload(); // Server truth, not optimistic model mutation.
    } catch (reason) {
      if (reason instanceof ApiError && reason.statusCode === 409) setFormError(labels.conflict);
      else if (reason instanceof ApiError && reason.statusCode === 403) setFormError(labels.forbidden);
      else if (reason instanceof ApiError && reason.statusCode === 422) {
        // server validation (IOETI error contract): localize by field, never show raw server text
        const field = reason.fields[0]?.field;
        setFormError(field === "name" ? labels.invalidName
          : field === "businessLineCode" ? labels.lineUnavailable : labels.unavailable);
      }
      else setFormError(problem(reason, isRTL));
    } finally { setSaving(false); }
  }
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getOpportunities(items.length, 25);
      setItems(previous => [...previous, ...next.filter(n => !previous.some(item => item.id === n.id))]);
      setMore(next.length === 25);
    } catch (reason) { setError(problem(reason, isRTL)); }
    finally { setLoadingMore(false); }
  }
  const visible = items.filter(item => {
    const query = filter.toLocaleLowerCase().trim();
    return !query || [item.name, item.reference || "", item.stage || "", item.businessLineCode || ""]
      .some(value => value.toLocaleLowerCase().includes(query));
  });
  const selectedIndex = selected ? visible.findIndex(row => row.id === selected.id) : -1;
  const record = selected ? <OpportunityRecordWorkspace
    record={selected} language={language} onBack={backToList}
    onRename={() => openRename(null, selected)}
    onRecordChanged={() => void getOpportunity(selected.id).then(setSelected).catch(() => undefined)}
    onPrevious={selectedIndex > 0 ? () => void openRecord(visible[selectedIndex - 1].id) : undefined}
    onNext={selectedIndex >= 0 && selectedIndex < visible.length - 1 ? () => void openRecord(visible[selectedIndex + 1].id) : undefined}
  /> : null;
  return <section className="page-enter opportunity-explorer">
    {record || (detailLoading && window.location.hash.startsWith("#/opportunities/")
      ? <div className="empty-state" role="status">{labels.loading}</div>
      : <div className="opportunities-list">

    <PageHeader eyebrow={labels.sales} title={labels.opportunities} description={labels.opportunitiesDescription}
      actions={<button type="button" className="btn btn-primary" onClick={openCreate}><Plus size={17}/>{labels.newOpportunity}</button>}/>
    <div className="list-toolbar"><label className="search-field"><Search size={18}/><span className="sr-only">{labels.searchOpportunities}</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder={labels.searchOpportunities}/></label><button className="icon-button" type="button" aria-label={labels.retry} onClick={() => void reload()}><RefreshCw size={17}/></button></div>
    <ErrorBanner message={error} onRetry={() => void reload()} retryLabel={labels.retry}/>
    <div className="data-panel">
      <div className="data-panel-heading"><strong>{labels.opportunities}</strong><span>{visible.length} {labels.result}</span></div>
      {loading ? <div className="empty-state" role="status">{labels.loading}</div> : visible.length === 0 ? <div className="empty-state">{labels.emptyOpportunities}</div>
        : <DataTable id="opportunities" caption={labels.opportunities} rows={visible} rowKey={item => item.id} labels={tableLabels(isRTL)}
          onOpen={(item, from) => void openRecord(item.id, from.querySelector<HTMLButtonElement>(".record-name-link") ?? undefined)} columns={[
          { key: "name", header: labels.opportunityName, sortValue: item => item.name,
            cell: item => <button type="button" className="record-name-link" onClick={event => void openRecord(item.id,event.currentTarget)}>{item.name}{arrow}</button> },
          { key: "line", header: labels.businessLines, sortValue: line,
            cell: item => line(item) || labels.none },
          { key: "stage", header: labels.stage, sortValue: item => item.stage ? stageLabel(item.stage, language) : null,
            cell: item => item.stage ? <span className={"stage-chip kind-" + (item.stageKind ?? "OPEN").toLowerCase()}>{stageLabel(item.stage, language)}</span> : labels.none },
          { key: "amount", header: isRTL ? "القيمة المتوقعة" : "Expected value", numeric: true, optional: true,
            sortValue: item => Number(item.amount) > 0 ? Number(item.amount) : null, cell: item => Number(item.amount) > 0 ? amount(item.amount, item.currencyCode, true) : "—" },
          { key: "probability", header: isRTL ? "الاحتمال" : "Probability", numeric: true, optional: true,
            sortValue: item => Number(item.probability) > 0 ? Number(item.probability) : null, cell: item => Number(item.probability) > 0 ? quantity(item.probability) + "%" : "—" },
          { key: "close", header: isRTL ? "الإغلاق المتوقع" : "Expected close", optional: true,
            sortValue: item => item.expectedCloseDate ?? null, cell: item => day(item.expectedCloseDate, isRTL) },
          { key: "reference", header: labels.reference, optional: true, sortValue: item => item.reference, cell: item => <code dir="ltr">{item.reference || "—"}</code> },
          { key: "actions", header: labels.actions,
            cell: item => <div className="opportunity-row-actions"><button type="button" className="text-action" onClick={e => void openRecord(item.id,e.currentTarget)}>{labels.details}{arrow}</button><button type="button" className="text-action" onClick={e => openRename(e.currentTarget,item)}>{labels.editOpportunity}</button></div> },
        ]}/>}
    </div>
    {more && <div className="load-more"><button type="button" className="btn btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? labels.loading : labels.moreRecords}</button></div>}
    <p className="scope-note"><ShieldCheck size={16}/>{labels.permissionNotice}</p>
    </div>)}
    {mode && <div className="drawer-overlay action-modal-overlay" onMouseDown={e => { if (!saving && e.target === e.currentTarget) setMode(null); }}>
      <section ref={dialogRef} className="action-modal" role="dialog" aria-modal="true" aria-labelledby="opportunity-form-title" aria-describedby="opportunity-form-description" tabIndex={-1} onKeyDown={onDialogKeyDown}>
        <header className="drawer-header"><div className="detail-kicker">{labels.sales}</div><button ref={closeRef} type="button" className="icon-button" aria-label={labels.back} disabled={saving} onClick={() => setMode(null)}><X size={18}/></button></header>
        <div className="drawer-body"><h2 id="opportunity-form-title">{mode.type === "create" ? labels.newOpportunity : labels.editOpportunity}</h2><p id="opportunity-form-description">{labels.opportunityFormHint}</p>
          <form id="opportunity-form" className="opportunity-form" onSubmit={e => void save(e)}>
            <label><span>{labels.opportunityName}</span><input ref={inputRef} maxLength={160} value={name} onChange={e => setName(e.target.value)} required minLength={3}/></label>
            {mode.type === "create" && <label><span>{labels.businessLines}</span><select required value={businessLineCode} disabled={creatable === null} onChange={e => setBusinessLineCode(e.target.value)}><option value="">{creatable === null ? labels.loading : labels.chooseLine}</option>{(creatable || []).map(line => <option key={line.id} value={line.code}>{isRTL ? line.nameAr : line.nameEn}</option>)}</select></label>}
            {mode.type === "create" && creatable !== null && creatable.length === 0 && !formError && <div className="login-error" role="status"><CircleAlert size={17}/>{labels.noCreatableLines}</div>}
            {formError && <div className="login-error" role="alert"><CircleAlert size={17}/>{formError}</div>}
          </form>
        </div>
        <footer className="drawer-footer drawer-actions"><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setMode(null)}>{labels.back}</button><button className="btn btn-primary" type="submit" form="opportunity-form" disabled={saving || (mode.type === "create" && !creatable?.length)}><Save size={16}/>{saving ? labels.loading : labels.save}</button></footer>
      </section>
    </div>}
  </section>;
}
