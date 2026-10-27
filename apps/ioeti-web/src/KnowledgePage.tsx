import { useCallback, useEffect, useState } from "react";
import { Archive, BookOpen, CircleAlert, FilePenLine, History, LockKeyhole, Plus, Search, Send } from "lucide-react";
import { ApiError, getBusinessLines, type BusinessLine } from "./api";
import {
  addCategory, archiveArticle, createArticle, getArticle, getCategories, getDrafts, publishArticle, saveArticle, searchArticles,
  type Article, type ArticleDraft, type ArticleSummary, type Category,
} from "./contentApi";
import type { Language } from "./preferences";
import "./content.css";

const strings = {
  ar: {
    title:"قاعدة المعرفة",sub:"إجراءات ومراجع داخلية ثنائية اللغة. القارئ يرى آخر نسخة منشورة فقط.",search:"ابحث في المقالات المنشورة...",
    category:"التصنيف",line:"خط العمل",all:"الكل",articles:"المقالات",editing:"التحرير",none:"لا توجد مقالات منشورة",noDrafts:"لا توجد مقالات للتحرير",
    open:"فتح",back:"رجوع للقائمة",revision:"النسخة",publishedBy:"نشرها",newArticle:"مقال جديد",titleEn:"العنوان بالإنجليزية",titleAr:"العنوان بالعربية",
    bodyEn:"النص بالإنجليزية",bodyAr:"النص بالعربية",save:"حفظ المسودة",edit:"تعديل",publish:"نشر",archive:"أرشفة",cancel:"إلغاء",
    unpublished:"تعديلات غير منشورة",status:{DRAFT:"مسودة",PUBLISHED:"منشور",ARCHIVED:"مؤرشف"},history:"النسخ المنشورة",
    addCategory:"إضافة تصنيف",code:"الرمز",nameEn:"الاسم بالإنجليزية",nameAr:"الاسم بالعربية",
    note:"النشر يسجّل من نشر ومتى؛ اعتماد المحتوى قبل النشر وفصل المهام بانتظار مصفوفة الأدوار D-07.",
    loading:"جار التحميل...",
    errors:{UNCHANGED:"لا يوجد تغيير منذ آخر نسخة منشورة.",ARTICLE_ARCHIVED:"المقال مؤرشف.",REQUIRED:"أكمل العنوان والنص بلغة واحدة على الأقل.",DUPLICATE:"هذا الرمز مستخدم.",
      FORMAT:"استخدم حروفًا وأرقامًا و- و_ فقط.",TOO_LONG:"النص أطول من المسموح.",conflict:"تم تعديل المقال من مكان آخر؛ حدّثناه، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Knowledge base",sub:"Bilingual internal procedures and references. Readers only see the latest published revision.",search:"Search published articles...",
    category:"Category",line:"Business line",all:"All",articles:"Articles",editing:"Editing",none:"No published articles",noDrafts:"No articles to edit",
    open:"Open",back:"Back to the list",revision:"Revision",publishedBy:"Published by",newArticle:"New article",titleEn:"English title",titleAr:"Arabic title",
    bodyEn:"English text",bodyAr:"Arabic text",save:"Save draft",edit:"Edit",publish:"Publish",archive:"Archive",cancel:"Cancel",
    unpublished:"Unpublished changes",status:{DRAFT:"Draft",PUBLISHED:"Published",ARCHIVED:"Archived"},history:"Published revisions",
    addCategory:"Add category",code:"Code",nameEn:"English name",nameAr:"Arabic name",
    note:"Publishing records who published and when; content approval before publishing and separation of duties wait for the role matrix (D-07).",
    loading:"Loading...",
    errors:{UNCHANGED:"Nothing changed since the published revision.",ARTICLE_ARCHIVED:"The article is archived.",REQUIRED:"Give a title and text in at least one language.",DUPLICATE:"This code is already used.",
      FORMAT:"Use letters, digits, - and _ only.",TOO_LONG:"The text is longer than allowed.",conflict:"The article changed elsewhere; it is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const errors = l.errors as Record<string, string>;
  const field = error.fields[0];
  if (field && errors[field.code]) return errors[field.code];
  if (error.code && errors[error.code]) return errors[error.code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";
const pick = (ar: boolean, arabic: string | null | undefined, english: string | null | undefined) => (ar ? arabic || english : english || arabic) || "—";

export function KnowledgePage({language}:{language:Language}){
  const l=strings[language];
  const ar=language==="ar";
  const [tab,setTab]=useState<"read"|"edit">("read");
  const [q,setQ]=useState("");
  const [categoryId,setCategoryId]=useState("");
  const [line,setLine]=useState("");
  const [categories,setCategories]=useState<Category[]>([]);
  const [lines,setLines]=useState<BusinessLine[]>([]);
  const [items,setItems]=useState<ArticleSummary[]|null>(null);
  const [drafts,setDrafts]=useState<ArticleSummary[]|null>(null);
  const [canEdit,setCanEdit]=useState(false);
  const [open,setOpen]=useState<Article|null>(null);
  const [draft,setDraft]=useState<ArticleDraft|null>(null);
  const [newCategory,setNewCategory]=useState<{code:string;nameEn:string;nameAr:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let current=true;
    void getCategories().then(c=>{if(current)setCategories(c);}).catch(()=>{});
    void getBusinessLines().then(b=>{if(current)setLines(b);}).catch(()=>{});
    void getDrafts().then(d=>{if(current){setDrafts(d);setCanEdit(true);}}).catch(()=>{if(current)setCanEdit(false);});
    return()=>{current=false;};
  },[]);
  const load=useCallback(async()=>{
    try{setItems(await searchArticles(q,categoryId?Number(categoryId):undefined,line||undefined));}
    catch(e){setItems([]);setError(message(e,l));}
  },[q,categoryId,line,l]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),250);return()=>window.clearTimeout(timer);},[load]);
  const refreshDrafts=()=>getDrafts().then(setDrafts).catch(()=>{});
  async function show(id:number){
    setError("");
    try{const article=await getArticle(id);setOpen(article);setDraft(null);}
    catch(e){setError(message(e,l));}
  }
  async function run(action:()=>Promise<Article|Category|void>,after?:(result:Article|Category|void)=>void){
    if(busy)return;
    setBusy(true);setError("");
    try{const result=await action();after?.(result);await Promise.all([load(),refreshDrafts()]);}
    catch(e){
      setError(message(e,l));
      // refresh the open article quietly so its version is current; keep the error above
      if(open)await getArticle(open.id).then(setOpen).catch(()=>{});
    }
    finally{setBusy(false);}
  }
  const categoryName=(id:number|null)=>{const c=categories.find(x=>x.id===id);return c?(ar?c.nameAr:c.nameEn):null;};
  const editor=draft&&<form className="ct-form ct-editor" onSubmit={e=>{e.preventDefault();void run(()=>open?.canEdit?saveArticle(open.id,open.version,draft):createArticle(draft),r=>{setOpen(r as Article);setDraft(null);});}}>
    <label><span>{l.titleAr}</span><input dir="rtl" value={draft.titleAr??""} maxLength={200} onChange={e=>setDraft({...draft,titleAr:e.target.value})}/></label>
    <label><span>{l.titleEn}</span><input dir="ltr" value={draft.titleEn??""} maxLength={200} onChange={e=>setDraft({...draft,titleEn:e.target.value})}/></label>
    <label><span>{l.bodyAr}</span><textarea dir="rtl" rows={8} value={draft.bodyAr??""} maxLength={50000} onChange={e=>setDraft({...draft,bodyAr:e.target.value})}/></label>
    <label><span>{l.bodyEn}</span><textarea dir="ltr" rows={8} value={draft.bodyEn??""} maxLength={50000} onChange={e=>setDraft({...draft,bodyEn:e.target.value})}/></label>
    <label><span>{l.category}</span><select value={draft.categoryId??""} onChange={e=>setDraft({...draft,categoryId:e.target.value?Number(e.target.value):null})}>
      <option value="">—</option>{categories.map(c=><option key={c.id} value={c.id}>{ar?c.nameAr:c.nameEn}</option>)}</select></label>
    <label><span>{l.line}</span><select value={draft.businessLineCode??""} onChange={e=>setDraft({...draft,businessLineCode:e.target.value||null})}>
      <option value="">{l.all}</option>{lines.map(b=><option key={b.code} value={b.code}>{ar?b.nameAr:b.nameEn}</option>)}</select></label>
    <div className="mk-actions"><button type="submit" className="btn btn-primary" disabled={busy||!(draft.titleAr?.trim()||draft.titleEn?.trim())}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={()=>setDraft(null)}>{l.cancel}</button></div>
  </form>;
  return <section className="page-enter ct-knowledge">
    <div className="page-title"><span className="eyebrow"><BookOpen size={14}/> IOETI</span><h1>{l.title}</h1><p>{l.sub}</p></div>
    {canEdit&&<div className="mk-tabs" role="group">
      <button type="button" className="btn btn-secondary" aria-pressed={tab==="read"} onClick={()=>{setTab("read");setOpen(null);setDraft(null);}}>{l.articles}</button>
      <button type="button" className="btn btn-secondary" aria-pressed={tab==="edit"} onClick={()=>{setTab("edit");setOpen(null);setDraft(null);}}><FilePenLine size={15}/>{l.editing}</button>
    </div>}
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {open?<article className="ct-article" aria-labelledby="ct-article-title">
      <button type="button" className="btn btn-secondary" onClick={()=>{setOpen(null);setDraft(null);}}>{l.back}</button>
      <h2 id="ct-article-title">{pick(ar,open.published?.titleAr??open.working?.titleAr,open.published?.titleEn??open.working?.titleEn)}</h2>
      <p className="wf-muted">{categoryName(open.categoryId)??""}{open.businessLineCode?` · ${open.businessLineCode}`:""}{open.published?` · ${l.revision} ${open.published.revision} · ${l.publishedBy} ${open.published.publishedBy??"—"} · ${stamp(open.published.publishedAt)}`:""}
        {open.canEdit&&<> · <span className="wf-status">{l.status[open.status]}</span>{open.working?.unpublishedChanges&&<> <span className="wf-status mk-out">{l.unpublished}</span></>}</>}</p>
      {open.published&&<div className="ct-bodies">
        {open.published.bodyAr&&<div dir="rtl" lang="ar" className="ct-body">{open.published.bodyAr}</div>}
        {open.published.bodyEn&&<div dir="ltr" lang="en" className="ct-body">{open.published.bodyEn}</div>}
      </div>}
      {open.canEdit&&(draft?editor:<div className="mk-actions">
        <button type="button" className="btn btn-secondary" disabled={open.status==="ARCHIVED"} onClick={()=>setDraft({titleEn:open.working?.titleEn??"",titleAr:open.working?.titleAr??"",bodyEn:open.working?.bodyEn??"",bodyAr:open.working?.bodyAr??"",categoryId:open.categoryId,businessLineCode:open.businessLineCode})}><FilePenLine size={15}/>{l.edit}</button>
        <button type="button" className="btn btn-primary" disabled={busy||open.status==="ARCHIVED"} onClick={()=>void run(()=>publishArticle(open.id,open.version),r=>setOpen(r as Article))}><Send size={15}/>{l.publish}</button>
        <button type="button" className="btn btn-secondary" disabled={busy||open.status==="ARCHIVED"} onClick={()=>void run(()=>archiveArticle(open.id,open.version),r=>setOpen(r as Article))}><Archive size={15}/>{l.archive}</button>
      </div>)}
      {open.canEdit&&open.revisions.length>0&&<details><summary><History size={14}/> {l.history} ({open.revisions.length})</summary>
        <ul className="wf-trail">{open.revisions.map(r=><li key={r.number}>{l.revision} {r.number}<small>{r.publishedBy??"—"} · {stamp(r.publishedAt)}</small></li>)}</ul></details>}
    </article>
    :tab==="read"?<>
      <div className="mk-filters">
        <label className="search-field"><Search size={18}/><span className="sr-only">{l.search}</span><input value={q} placeholder={l.search} onChange={e=>setQ(e.target.value)}/></label>
        <label><span>{l.category}</span><select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">{l.all}</option>
          {categories.map(c=><option key={c.id} value={c.id}>{ar?c.nameAr:c.nameEn}</option>)}</select></label>
        <label><span>{l.line}</span><select value={line} onChange={e=>setLine(e.target.value)}><option value="">{l.all}</option>
          {lines.map(b=><option key={b.code} value={b.code}>{ar?b.nameAr:b.nameEn}</option>)}</select></label>
      </div>
      {items===null?<p className="wf-muted" role="status">{l.loading}</p>:items.length===0?<p className="wf-muted">{l.none}</p>:
      <ul className="wf-list ct-articles">{items.map(item=><li key={item.id}><span><strong>{pick(ar,item.titleAr,item.titleEn)}</strong>
        <small className="mk-sub">{categoryName(item.categoryId)??"—"} · {l.revision} {item.revision} · {stamp(item.publishedAt)}</small></span>
        <button type="button" className="btn btn-secondary" onClick={()=>void show(item.id)}>{l.open}</button></li>)}</ul>}
    </>
    :<>
      <div className="mk-actions">
        <button type="button" className="btn btn-primary" onClick={()=>{setOpen(null);setDraft({});}}><Plus size={15}/>{l.newArticle}</button>
        {!newCategory&&<button type="button" className="btn btn-secondary" onClick={()=>setNewCategory({code:"",nameEn:"",nameAr:""})}><Plus size={15}/>{l.addCategory}</button>}
      </div>
      {newCategory&&<form className="ct-form ct-inline-form" onSubmit={e=>{e.preventDefault();void run(()=>addCategory(newCategory.code,newCategory.nameEn,newCategory.nameAr),c=>{setCategories(cs=>[...cs,c as Category]);setNewCategory(null);});}}>
        <label><span>{l.code}</span><input dir="ltr" value={newCategory.code} maxLength={40} required onChange={e=>setNewCategory({...newCategory,code:e.target.value})}/></label>
        <label><span>{l.nameAr}</span><input value={newCategory.nameAr} required onChange={e=>setNewCategory({...newCategory,nameAr:e.target.value})}/></label>
        <label><span>{l.nameEn}</span><input value={newCategory.nameEn} required onChange={e=>setNewCategory({...newCategory,nameEn:e.target.value})}/></label>
        <div className="mk-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.addCategory}</button>
          <button type="button" className="btn btn-secondary" onClick={()=>setNewCategory(null)}>{l.cancel}</button></div>
      </form>}
      {draft&&editor}
      {drafts===null?<p className="wf-muted" role="status">{l.loading}</p>:drafts.length===0?<p className="wf-muted">{l.noDrafts}</p>:
      <ul className="wf-list ct-articles">{drafts.map(item=><li key={item.id}><span><strong>{pick(ar,item.titleAr,item.titleEn)}</strong>
        <small className="mk-sub">{l.status[item.status]}{item.revision?` · ${l.revision} ${item.revision}`:""}</small></span>
        <button type="button" className="btn btn-secondary" onClick={()=>void show(item.id)}>{l.open}</button></li>)}</ul>}
    </>}
    <p className="wf-muted"><LockKeyhole size={13}/> {l.note}</p>
  </section>;
}
