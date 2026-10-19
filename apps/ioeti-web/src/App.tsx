import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, Building2,
  Check, ChevronDown, CircleAlert, CircleHelp, Crown, GraduationCap,
  HeartHandshake, House, Layers3, LockKeyhole, Menu,
  Moon, Palette, RefreshCw, Search, Settings2,
  ShieldCheck, Sun, Workflow, UsersRound, X,
} from "lucide-react";
import { ApiError, getBusinessLines, getSession, signIn, type BusinessLine, type SessionIdentity } from "./api";
import { OpportunitiesPage } from "./OpportunitiesPage";
import { NativeModules } from "./NativeModules";
import { DirectoryPage } from "./DirectoryPage";
import { DEMO_MODE } from "./demo";
import { t } from "./labels";
import { usePreferences, type Theme } from "./preferences";

type Page = "home" | "businessLines" | "opportunities" | "leads" | "accounts" | "capabilities" | "design";
type Session = "checking" | "login" | "authenticated";
type LineFilter = "all" | "active" | "setup" | "suspended";
type IconType = typeof House;

function statusName(status: number, labels: ReturnType<typeof t>) {
  if (status === 2) return labels.active;
  if (status === 3) return labels.suspended;
  return labels.setup;
}
function StatusPill({ status, labels }: { status: number; labels: ReturnType<typeof t> }) {
  return <span className={"status-pill status-" + status}><span className="status-dot" />{statusName(status, labels)}</span>;
}
function IconButton({ children, onClick, label, className = "" }: { children: React.ReactNode; onClick: () => void; label: string; className?: string }) {
  return <button className={"icon-button " + className} onClick={onClick} type="button" aria-label={label} title={label}>{children}</button>;
}

export function App() {
  const prefs = usePreferences();
  const labels = t(prefs.language);
  const [page, setPage] = useState<Page>("home");
  const [session, setSession] = useState<Session>("checking");
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<BusinessLine | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LineFilter>("all");
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedReturnFocus = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  async function refresh() {
    setBusy(true);
    setLoadError("");
    try {
      const values = await getBusinessLines();
      setLines(values);
      setSession("authenticated");
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        setSession("login");
        setLines([]);
      } else {
        setLoadError(error instanceof Error ? error.message : labels.unavailable);
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    // Identity and per-module permissions are independent concepts.
    void getSession()
      .then(async (user) => {
        setIdentity(user);
        setSession("authenticated");
        try { setLines(await getBusinessLines()); }
        catch (error) {
          if (error instanceof ApiError && error.statusCode === 401) { setSession("login"); return; }
          setLoadError(error instanceof ApiError && error.statusCode === 403
            ? (prefs.language === "ar" ? "حسابك لا يملك صلاحية قراءة خطوط الأعمال." : "No permission to read business lines.")
            : (error instanceof Error ? error.message : "Could not load business lines"));
        }
      })
      .catch((error) => {
        if (!(error instanceof ApiError) || error.statusCode !== 401) {
          setLoadError(error instanceof Error ? error.message : "Server unavailable");
        }
        setSession("login");
      });
    // Use the initial locale for this one-time authenticated bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    drawerCloseRef.current?.focus();
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
      selectedReturnFocus.current?.focus();
    };
  }, [selected]);

  const matching = useMemo(() => lines.filter((line) => {
    const query = search.trim().toLocaleLowerCase();
    const text = [line.code, line.nameAr, line.nameEn, line.responsibleTeam || ""].join(" ").toLocaleLowerCase();
    const validStatus = status === "all" || (status === "active" && line.status === 2) ||
      (status === "setup" && line.status === 1) || (status === "suspended" && line.status === 3);
    return validStatus && (!query || text.includes(query));
  }), [lines, search, status]);
  const activeCount = lines.filter((line) => line.status === 2).length;
  const isRTL = prefs.language === "ar";

  function navigate(next: Page) { setPage(next); setMobileNav(false); setSelected(null); }
  function openLine(line: BusinessLine, source: HTMLButtonElement) {
    selectedReturnFocus.current = source;
    setSelected(line);
  }

  if (session === "checking") return <div className="centered-loading"><span className="brand-emblem"><Layers3 size={28} /></span><span>{labels.loading}</span></div>;
  if (session === "login") return <Login labels={labels} initialError={loadError} onSuccess={async () => {
    const user = await getSession();
    setIdentity(user);
    setSession("authenticated");
    setLoadError("");
    try { setLines(await getBusinessLines()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : labels.unavailable); }
  }} />;

  const mainNav: { id: Page | string; label: string; icon: IconType; disabled?: boolean }[] = [
    { id: "home", label: labels.home, icon: House },
    { id: "businessLines", label: labels.businessLines, icon: Layers3 },
    { id: "opportunities", label: labels.sales, icon: Activity },
    { id: "leads", label: labels.leads, icon: UsersRound },
    { id: "capabilities", label: labels.capabilityMap, icon: Workflow },
    { id: "accounts", label: labels.accountDirectory, icon: Building2 },
    { id: "certification", label: labels.certification, icon: BadgeCheck, disabled: true },
    { id: "training", label: labels.training, icon: GraduationCap, disabled: true },
    { id: "recruitment", label: labels.recruitment, icon: BriefcaseBusiness, disabled: true },
    { id: "fundraising", label: labels.fundraising, icon: HeartHandshake, disabled: true },
  ];
  const secondaryNav: { id: Page | string; label: string; icon: IconType; disabled?: boolean }[] = [
    { id: "design", label: labels.design, icon: Palette },
    { id: "settings", label: labels.settings, icon: Settings2, disabled: true },
  ];

  function renderNav(items: typeof mainNav) {
    return items.map((item) => {
      const ItemIcon = item.icon;
      const active = item.id === page;
      return <button
        key={item.id} type="button" disabled={item.disabled}
        className={"nav-item" + (active ? " is-active" : "")}
        aria-current={active ? "page" : undefined}
        title={item.disabled ? item.label + " · " + labels.upcoming : item.label}
        onClick={() => navigate(item.id as Page)}
      ><ItemIcon size={19} strokeWidth={active ? 2.35 : 1.85} /><span className="nav-label">{item.label}</span>{item.disabled && <span className="coming-indicator" aria-label={labels.upcoming} />}</button>;
    });
  }

  return <div className="app-frame">
    {DEMO_MODE && <div className="demo-banner" role="status"><ShieldCheck size={15}/><span>{isRTL ? "نسخة معاينة عامة · بيانات افتراضية للتصميم فقط · أي تعديل مؤقت وغير محفوظ" : "Public UI preview · Sample data only · Edits are temporary and never saved"}</span></div>}
    <a className="skip-link" href="#main-content">{labels.workspace}</a>
    {mobileNav && <button className="nav-backdrop" type="button" aria-label={labels.back} onClick={() => setMobileNav(false)} />}
    <aside className={"side-panel" + (mobileNav ? " mobile-open" : "")}>
      <div className="side-brand"><div className="brand-emblem"><Layers3 size={22}/></div><div className="brand-copy"><strong>IOETI</strong><small>{labels.subtitle}</small></div></div>
      <div className="side-section-caption">{labels.workspace}</div>
      <nav aria-label={labels.workspace} className="side-nav">{renderNav(mainNav)}</nav>
      <div className="side-spacer"/>
      <nav aria-label={labels.settings} className="side-nav side-footer-nav">{renderNav(secondaryNav)}</nav>
      <div className="side-footnote"><span className="live-pulse" /><span className="footnote-label">{DEMO_MODE ? (isRTL ? "معاينة تجريبية" : "Preview mode") : labels.connected}</span></div>
    </aside>

    <div className="app-stage">
      <header className="top-bar">
        <div className="top-start">
          <IconButton className="mobile-menu" label={labels.navigation} onClick={() => setMobileNav(true)}><Menu size={19}/></IconButton>
          <div className="breadcrumb"><span>{labels.workspace}</span><span className="crumb-separator">/</span><strong>{page === "home" ? labels.home : page === "businessLines" ? labels.businessLines : page === "opportunities" ? labels.opportunities : page === "leads" ? labels.leads : page === "accounts" ? labels.accountDirectory : page === "capabilities" ? labels.capabilityMap : labels.design}</strong></div>
        </div>
        <div className="top-actions">
          <span className="server-status"><span className="live-pulse"/>{DEMO_MODE ? (isRTL ? "بيانات افتراضية" : "Sample data") : labels.connected}</span>
          <button className="language-button" type="button" onClick={() => prefs.setLanguage(isRTL ? "en" : "ar")} aria-label={labels.language}>{isRTL ? "EN" : "ع"}</button>
          <div className="top-divider"/>
          <span className="account-avatar" aria-label={identity?.name || labels.workspace} title={identity?.name || identity?.code || ""}>{(identity?.name || identity?.code || "I").slice(0,1).toUpperCase()}</span>
        </div>
      </header>

      <main id="main-content" className="main-content">
        {loadError && <div className="error-banner" role="alert"><CircleAlert size={18}/><span>{labels.unavailable}: {loadError}</span><button className="btn btn-secondary" type="button" onClick={() => void refresh()}>{labels.retry}</button></div>}
        {page === "home" && <section className="page-enter">
          <div className="hero-card">
            <div className="hero-text"><span className="eyebrow"><span className="live-pulse"/>{labels.product}</span><h1>{labels.welcome}</h1><p>{labels.overview}</p>
              <button className="btn btn-primary" type="button" onClick={() => navigate("businessLines")}>{labels.showLines}{isRTL ? <ArrowLeft size={18}/> : <ArrowRight size={18}/>}</button>
            </div>
            <div className="hero-graphic" aria-hidden="true"><div className="orb orb-a"/><div className="orb orb-b"/><div className="orb-core"><Layers3 size={45}/></div></div>
          </div>
          <div className="stats-grid">
            <Metric icon={Layers3} label={labels.linesCount} value={lines.length.toString()} />
            <Metric icon={Check} label={labels.activeCount} value={activeCount.toString()} />
          </div>
          <div className="section-top"><div><span className="eyebrow">{labels.workspace}</span><h2>{labels.businessLines}</h2></div><button className="btn btn-secondary" type="button" onClick={() => navigate("businessLines")}>{labels.view}{isRTL ? <ArrowLeft size={16}/> : <ArrowRight size={16}/>}</button></div>
          <div className="lines-preview">
            {lines.length === 0 ? <div className="empty-state">{labels.noAccess}</div> : lines.slice(0, 5).map((line) => <button key={line.id} className="preview-row" type="button" onClick={(event) => openLine(line, event.currentTarget)}><div className="line-monogram">{line.code.slice(0, 2)}</div><div className="line-name"><strong>{isRTL ? line.nameAr : line.nameEn}</strong><small dir="ltr">{line.code}</small></div><StatusPill status={line.status} labels={labels}/><ChevronDown className="row-chevron" size={17}/></button>)}
          </div>
          <p className="scope-note"><ShieldCheck size={15}/>{DEMO_MODE ? (isRTL ? "كل البيانات الظاهرة افتراضية ولا تمثل عملاء IOETI" : "All displayed business records are fictional") : labels.visualNote}</p>
        </section>}

        {page === "opportunities" && <OpportunitiesPage language={prefs.language} lines={lines} labels={labels} />}
        {page === "leads" && <DirectoryPage kind="leads" language={prefs.language} />}
        {page === "accounts" && <DirectoryPage kind="accounts" language={prefs.language} />}
        {page === "capabilities" && <NativeModules language={prefs.language} />}
        {page === "businessLines" && <section className="page-enter">
          <PageTitle eyebrow={labels.workspace} title={labels.businessLines} description={labels.description} />
          <div className="list-toolbar"><label className="search-field"><Search size={18}/><span className="sr-only">{labels.search}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={labels.search}/>{search && <button type="button" aria-label={labels.back} onClick={() => setSearch("")}><X size={16}/></button>}</label>
            <div className="toolbar-end"><div className="segmented" role="group" aria-label={labels.status}>{(["all","active","setup","suspended"] as LineFilter[]).map((x) => <button key={x} type="button" className={status === x ? "chosen" : ""} aria-pressed={status === x} onClick={() => setStatus(x)}>{labels[x]}</button>)}</div>
            <IconButton label={labels.retry} onClick={() => void refresh()}><RefreshCw size={18} className={busy ? "spin" : ""}/></IconButton></div>
          </div>
          <div className="data-panel"><div className="data-panel-heading"><strong>{labels.allLines}</strong><span>{matching.length} {labels.result}</span></div>
            {matching.length === 0 ? <div className="empty-state"><CircleHelp size={28}/>{labels.empty}</div> : <div className="table-scroll"><table><thead><tr><th>{labels.businessLines}</th><th>{labels.code}</th><th>{labels.team}</th><th>{labels.status}</th><th><span className="sr-only">{labels.actions}</span></th></tr></thead>
            <tbody>{matching.map((line) => <tr key={line.id}><td><div className="table-primary"><div className="line-monogram">{line.code.slice(0, 2)}</div><div><strong>{isRTL ? line.nameAr : line.nameEn}</strong><small>{isRTL ? line.nameEn : line.nameAr}</small></div></div></td><td><code dir="ltr">{line.code}</code></td><td>{line.responsibleTeam || labels.none}</td><td><StatusPill status={line.status} labels={labels}/></td><td><button className="text-action" type="button" onClick={(event) => openLine(line, event.currentTarget)}>{labels.details}{isRTL ? <ArrowLeft size={15}/> : <ArrowRight size={15}/>}</button></td></tr>)}</tbody></table></div>}
          </div>
          <p className="scope-note"><LockKeyhole size={15}/>{labels.visualNote}</p>
        </section>}

        {page === "design" && <DesignLab labels={labels}/>}
      </main>
    </div>
    {selected && <div className="drawer-overlay" onMouseDown={(e) => { if (e.currentTarget === e.target) setSelected(null); }}><section role="dialog" aria-modal="true" aria-labelledby="line-dialog-title" className="record-drawer">
      <div className="drawer-header"><div className="detail-kicker">{labels.businessLines}</div><IconButton label={labels.back} onClick={() => setSelected(null)}><X size={19}/></IconButton></div>
      <div className="drawer-body"><div className="detail-icon"><Layers3 size={28}/></div><h2 id="line-dialog-title">{isRTL ? selected.nameAr : selected.nameEn}</h2><p>{isRTL ? selected.nameEn : selected.nameAr}</p><StatusPill status={selected.status} labels={labels}/>
        <dl className="detail-list"><div><dt>{labels.code}</dt><dd dir="ltr">{selected.code}</dd></div><div><dt>{labels.team}</dt><dd>{selected.responsibleTeam || labels.none}</dd></div><div><dt>{labels.status}</dt><dd>{statusName(selected.status, labels)}</dd></div></dl>
        <p className="scope-note">{DEMO_MODE ? (isRTL ? "هذه البيانات توضيحية فقط" : "Sample data for preview only") : labels.noOperations}</p>
      </div><div className="drawer-footer"><button ref={drawerCloseRef} type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>{labels.back}</button></div>
    </section></div>}
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return <div className="metric-card"><span className="metric-icon"><Icon size={21}/></span><div><span>{label}</span><strong dir="ltr">{value}</strong></div></div>;
}
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function Login({ labels, onSuccess, initialError }: { labels: ReturnType<typeof t>; onSuccess: () => Promise<void>; initialError?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setPending(true); setError("");
    try { await signIn(username.trim(), password); await onSuccess(); }
    catch { setError(labels.signInError); }
    finally { setPending(false); }
  }
  return <div className="login-screen">
    <div className="login-brand"><span className="brand-emblem"><Layers3 size={25}/></span><span><strong>IOETI</strong><small>{labels.subtitle}</small></span></div>
    <div className="login-card"><span className="login-top-icon"><LockKeyhole size={24}/></span><span className="eyebrow">{labels.session}</span><h1>{labels.signin}</h1><p>{labels.loginHelp}</p>
      <form onSubmit={(e) => void submit(e)} className="login-form">
        <label>{labels.username}<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
        <label>{labels.password}<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {(error || initialError) && <div className="login-error" role="alert"><CircleAlert size={17}/>{error || initialError}</div>}
        <button type="submit" className="btn btn-primary login-submit" disabled={pending}>{pending ? labels.loading : labels.loginButton}{<ArrowLeft size={18}/>}</button>
      </form>
    </div>
    <p className="login-caption">{labels.product} · IOETI Egypt</p>
  </div>;
}

function DesignLab({ labels }: { labels: ReturnType<typeof t> }) {
  const prefs = usePreferences();
  const themes: { id: Theme; label: string; icon: IconType }[] = [
    { id: "light", label: labels.light, icon: Sun },
    { id: "dark", label: labels.dark, icon: Moon },
    { id: "luxury", label: labels.luxury, icon: Crown },
  ];
  return <section className="page-enter">
    <PageTitle eyebrow={labels.design} title={labels.palette} description={labels.styleHint}/>
    <h2 className="design-section-title">{labels.display}</h2>
    <div className="theme-grid">{themes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={"theme-choice theme-" + id + (prefs.theme === id ? " selected" : "")} aria-pressed={prefs.theme === id} onClick={() => prefs.setTheme(id)}><div className="theme-art"><div className="theme-art-rail"/><div className="theme-art-body"><span/><span/><span/></div></div><div className="theme-meta"><Icon size={19}/><strong>{label}</strong>{prefs.theme === id && <Check size={18} className="selected-check"/>}</div></button>)}</div>
    <div className="preferences-grid"><div className="preference-block"><span>{labels.density}</span><div className="segmented"><button type="button" className={prefs.density === "comfortable" ? "chosen" : ""} onClick={() => prefs.setDensity("comfortable")}>{labels.comfortable}</button><button type="button" className={prefs.density === "compact" ? "chosen" : ""} onClick={() => prefs.setDensity("compact")}>{labels.compact}</button></div></div>
      <div className="preference-block"><span>{labels.navigation}</span><div className="segmented"><button type="button" className={prefs.navigation === "expanded" ? "chosen" : ""} onClick={() => prefs.setNavigation("expanded")}>{labels.expanded}</button><button type="button" className={prefs.navigation === "rail" ? "chosen" : ""} onClick={() => prefs.setNavigation("rail")}>{labels.rail}</button></div></div></div>
    <h2 className="design-section-title">{labels.preview}</h2>
    <div className="component-showcase"><div className="showcase-card"><span className="eyebrow">{labels.actions}</span><div className="showcase-actions"><button className="btn btn-primary" type="button" onClick={(e) => e.currentTarget.blur()}>{labels.primaryAction}<ArrowLeft size={16}/></button><button className="btn btn-secondary" type="button" onClick={(e) => e.currentTarget.blur()}>{labels.secondaryAction}</button></div></div>
      <div className="showcase-card"><span className="eyebrow">{labels.status}</span><div className="showcase-actions"><StatusPill status={2} labels={labels}/><StatusPill status={1} labels={labels}/><StatusPill status={3} labels={labels}/></div></div>
      <div className="showcase-card"><label className="sample-field"><span>{labels.sampleField}</span><input placeholder={labels.samplePlaceholder}/></label></div>
    </div>
  </section>;
}
