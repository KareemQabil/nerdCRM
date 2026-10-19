import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Plus, RefreshCw, Save, Search, ShieldCheck, X } from "lucide-react";
import {
  ApiError, createOpportunity, getOpportunities, getOpportunity, renameOpportunity,
  type BusinessLine, type Opportunity,
} from "./api";
import { type Language } from "./preferences";
import { OpportunityRecordWorkspace } from "./OpportunityRecordWorkspace";

type Labels = Record<string, string>;
type Props = { language: Language; lines: BusinessLine[]; labels: Labels };
type Mode = { type: "create" } | { type: "rename"; item: Opportunity };

export function OpportunitiesPage({ language, lines, labels }: Props) {
  const [items, setItems] = useState<Opportunity[]>([]);
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
  const previousFocus = useRef<HTMLElement | null>(null);
  const isRTL = language === "ar";
  const arrow = isRTL ? <ArrowLeft size={17} /> : <ArrowRight size={17}/>;

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const values = await getOpportunities(0, 25);
      setItems(values);
      setMore(values.length === 25);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.unavailable);
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
            ? labels.forbidden : reason instanceof Error ? reason.message : labels.unavailable);
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
        ? labels.forbidden : reason instanceof Error ? reason.message : labels.unavailable);
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
    closeRef.current?.focus();
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setMode(null); }
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); previousFocus.current?.focus(); };
  }, [mode]);

  function openCreate(event: React.MouseEvent<HTMLButtonElement>) {
    previousFocus.current = event.currentTarget;
    setName(""); setBusinessLineCode(lines.find(line => line.status === 2)?.code || "");
    setFormError(""); setMode({ type: "create" });
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
      else setFormError(reason instanceof Error ? reason.message : labels.unavailable);
    } finally { setSaving(false); }
  }
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getOpportunities(items.length, 25);
      setItems(previous => [...previous, ...next.filter(n => !previous.some(item => item.id === n.id))]);
      setMore(next.length === 25);
    } catch (reason) { setError(reason instanceof Error ? reason.message : labels.unavailable); }
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
    onPrevious={selectedIndex > 0 ? () => void openRecord(visible[selectedIndex - 1].id) : undefined}
    onNext={selectedIndex >= 0 && selectedIndex < visible.length - 1 ? () => void openRecord(visible[selectedIndex + 1].id) : undefined}
  /> : null;
  return <section className="page-enter opportunity-explorer">
    {record || (detailLoading && window.location.hash.startsWith("#/opportunities/")
      ? <div className="empty-state" role="status">{labels.loading}</div>
      : <div className="opportunities-list">

    <div className="page-heading-actions">
      <div className="page-title"><span className="eyebrow">{labels.sales}</span><h1>{labels.opportunities}</h1><p>{labels.opportunitiesDescription}</p></div>
      <button type="button" className="btn btn-primary" onClick={openCreate}><Plus size={17}/>{labels.newOpportunity}</button>
    </div>
    <div className="list-toolbar"><label className="search-field"><Search size={18}/><span className="sr-only">{labels.searchOpportunities}</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder={labels.searchOpportunities}/></label><button className="icon-button" type="button" aria-label={labels.retry} onClick={() => void reload()}><RefreshCw size={17}/></button></div>
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => void reload()}>{labels.retry}</button></div>}
    <div className="data-panel">
      <div className="data-panel-heading"><strong>{labels.opportunities}</strong><span>{visible.length} {labels.result}</span></div>
      {loading ? <div className="empty-state" role="status">{labels.loading}</div> : visible.length === 0 ? <div className="empty-state">{labels.emptyOpportunities}</div> : <div className="table-scroll">
        <table><thead><tr><th>{labels.opportunityName}</th><th>{labels.businessLines}</th><th>{labels.stage}</th><th>{labels.reference}</th><th>{labels.actions}</th></tr></thead>
          <tbody>{visible.map(item => <tr key={item.id}>
            <td><button type="button" className="record-name-link" onClick={event => void openRecord(item.id,event.currentTarget)}>{item.name}{arrow}</button></td>
            <td>{isRTL ? item.businessLineNameAr || item.businessLineCode || labels.none : item.businessLineNameEn || item.businessLineCode || labels.none}</td>
            <td>{item.stage || labels.none}</td><td><code dir="ltr">{item.reference || "—"}</code></td>
            <td><div className="opportunity-row-actions"><button type="button" className="text-action" onClick={e => void openRecord(item.id,e.currentTarget)}>{labels.details}{arrow}</button><button type="button" className="text-action" onClick={e => openRename(e.currentTarget,item)}>{labels.editOpportunity}</button></div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
    {more && <div className="load-more"><button type="button" className="btn btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? labels.loading : labels.moreRecords}</button></div>}
    <p className="scope-note"><ShieldCheck size={16}/>{labels.permissionNotice}</p>
    </div>)}
    {mode && <div className="drawer-overlay action-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setMode(null); }}>
      <section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="opportunity-form-title">
        <header className="drawer-header"><div className="detail-kicker">{labels.sales}</div><button ref={closeRef} type="button" className="icon-button" aria-label={labels.back} onClick={() => setMode(null)}><X size={18}/></button></header>
        <div className="drawer-body"><h2 id="opportunity-form-title">{mode.type === "create" ? labels.newOpportunity : labels.editOpportunity}</h2><p>{labels.opportunityFormHint}</p>
          <form id="opportunity-form" className="opportunity-form" onSubmit={e => void save(e)}>
            <label><span>{labels.opportunityName}</span><input autoFocus maxLength={160} value={name} onChange={e => setName(e.target.value)} required minLength={3}/></label>
            {mode.type === "create" && <label><span>{labels.businessLines}</span><select required value={businessLineCode} onChange={e => setBusinessLineCode(e.target.value)}><option value="">{labels.chooseLine}</option>{lines.filter(line => line.status === 2).map(line => <option key={line.id} value={line.code}>{isRTL ? line.nameAr : line.nameEn}</option>)}</select></label>}
            {formError && <div className="login-error" role="alert"><CircleAlert size={17}/>{formError}</div>}
          </form>
        </div>
        <footer className="drawer-footer drawer-actions"><button className="btn btn-secondary" type="button" onClick={() => setMode(null)}>{labels.back}</button><button className="btn btn-primary" type="submit" form="opportunity-form" disabled={saving}><Save size={16}/>{saving ? labels.loading : labels.save}</button></footer>
      </section>
    </div>}
  </section>;
}
