import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, CircleAlert, Download, FilePlus2, FileText, History, LockKeyhole, Upload } from "lucide-react";
import { ApiError } from "./api";
import {
  ACCEPTED_FILES, archiveDocument, fileDocument, getDocuments, readFile, reviseDocument, revisionUrl,
  type DocumentKind, type DocumentLanguage, type RecordDocument, type Subject,
} from "./contentApi";
import type { Language } from "./preferences";
import "./content.css";

const strings = {
  ar: {
    documents:"المستندات",none:"لا توجد مستندات على هذا السجل",add:"إضافة مستند",title:"العنوان",kind:"النوع",language:"اللغة",file:"الملف",
    summary:"ما الذي تغير (اختياري)",save:"حفظ",saving:"جار الرفع...",cancel:"إلغاء",newRevision:"رفع إصدار جديد",archive:"أرشفة",
    revision:"الإصدار",download:"تنزيل",history:"الإصدارات السابقة",by:"بواسطة",
    kinds:{PROPOSAL:"عرض فني/مالي",CONTRACT:"مسودة عقد",EVIDENCE:"دليل",REPORT:"تقرير",CORRESPONDENCE:"مراسلة",OTHER:"أخرى"},
    languages:{AR:"عربي",EN:"إنجليزي",BILINGUAL:"ثنائي اللغة"},
    hint:"PDF أو Word أو Excel أو PowerPoint أو صور PNG/JPEG أو نص، حتى 10 ميجابايت. الإصدارات لا تُعدّل ولا تُحذف.",
    templates:"قوالب المستندات الرسمية (الشروط والشهادات) بانتظار اعتماد D-02 وD-03 وD-11.",
    errors:{TOO_LARGE:"الحد الأقصى للملف 10 ميجابايت.",TYPE_NOT_ALLOWED:"نوع الملف غير مسموح.",TYPE_MISMATCH:"محتوى الملف لا يطابق امتداده.",UNCHANGED:"هذا الملف مطابق للإصدار الحالي.",
      DOCUMENT_ARCHIVED:"المستند مؤرشف.",REQUIRED:"أكمل الحقول المطلوبة.",conflict:"تم تعديل المستند من مكان آخر؛ حدّثناه، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    documents:"Documents",none:"No documents on this record",add:"Add document",title:"Title",kind:"Kind",language:"Language",file:"File",
    summary:"What changed (optional)",save:"Save",saving:"Uploading...",cancel:"Cancel",newRevision:"Upload new revision",archive:"Archive",
    revision:"Revision",download:"Download",history:"Earlier revisions",by:"by",
    kinds:{PROPOSAL:"Proposal",CONTRACT:"Contract draft",EVIDENCE:"Evidence",REPORT:"Report",CORRESPONDENCE:"Correspondence",OTHER:"Other"},
    languages:{AR:"Arabic",EN:"English",BILINGUAL:"Bilingual"},
    hint:"PDF, Word, Excel, PowerPoint, PNG/JPEG images or text, up to 10 MiB. Revisions are never changed or deleted.",
    templates:"Official document templates (terms, certificates) wait for D-02, D-03 and D-11.",
    errors:{TOO_LARGE:"Files can be at most 10 MiB.",TYPE_NOT_ALLOWED:"This file type is not allowed.",TYPE_MISMATCH:"The file content does not match its extension.",UNCHANGED:"This file is the same as the current revision.",
      DOCUMENT_ARCHIVED:"The document is archived.",REQUIRED:"Complete the required fields.",conflict:"The document changed elsewhere; it is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
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
const size = (bytes: number | null) => bytes == null ? "—" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Documents filed on one record; access follows the record (the server checks it on every call). */
export function DocumentsPanel({subject,subjectId,language,onChanged,defaultKind="PROPOSAL"}:{subject:Subject; subjectId:number; language:Language;
  /** Called after a document is filed, revised or archived (e.g. so an evidence picker reloads). */
  onChanged?:()=>void; defaultKind?:DocumentKind}){
  const l=strings[language];
  const [docs,setDocs]=useState<RecordDocument[]|null>(null);
  const [adding,setAdding]=useState(false);
  const [title,setTitle]=useState("");
  const [kind,setKind]=useState<DocumentKind>(defaultKind);
  const [docLanguage,setDocLanguage]=useState<DocumentLanguage>("BILINGUAL");
  const [summary,setSummary]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [reviseId,setReviseId]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [loadError,setLoadError]=useState("");
  const fileInput=useRef<HTMLInputElement|null>(null);
  const load=useCallback(async()=>{
    try{setDocs(await getDocuments(subject,subjectId));setLoadError("");}
    catch(e){setDocs([]);setLoadError(message(e,l));}
  },[subject,subjectId,l]);
  useEffect(()=>{void load();},[load]);
  function reset(){setAdding(false);setReviseId(null);setTitle("");setSummary("");setFile(null);if(fileInput.current)fileInput.current.value="";}
  async function run(action:()=>Promise<unknown>){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();reset();onChanged?.();}
    catch(e){setError(message(e,l));}
    finally{await load();setBusy(false);}
  }
  const upload=(doc?:RecordDocument)=>run(async()=>{
    if(!file)return;
    const content=await readFile(file);
    if(doc)await reviseDocument(doc.id,doc.version,file.name,content,summary||undefined);
    else await fileDocument({subject,subjectId,title,kind,language:docLanguage,fileName:file.name,contentBase64:content,changeSummary:summary||undefined});
  });
  const fileField=<label><span>{l.file}</span><input ref={fileInput} type="file" accept={ACCEPTED_FILES} required onChange={e=>setFile(e.target.files?.[0]??null)}/></label>;
  return <section className="ct-documents" aria-labelledby={`ct-docs-${subject}-${subjectId}`}>
    <div className="ct-head"><h3 id={`ct-docs-${subject}-${subjectId}`}><FileText size={17}/>{l.documents}</h3>
      {!adding&&<button type="button" className="btn btn-secondary" onClick={()=>{reset();setAdding(true);}}><FilePlus2 size={15}/>{l.add}</button>}</div>
    {error&&<p className="mk-error ct-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {loadError&&<p className="mk-error ct-error"><CircleAlert size={15}/>{loadError}</p>}
    {adding&&<form className="ct-form" onSubmit={e=>{e.preventDefault();void upload();}}>
      <label><span>{l.title}</span><input value={title} maxLength={200} required onChange={e=>setTitle(e.target.value)}/></label>
      <label><span>{l.kind}</span><select value={kind} onChange={e=>setKind(e.target.value as DocumentKind)}>
        {(Object.keys(l.kinds) as DocumentKind[]).map(k=><option key={k} value={k}>{l.kinds[k]}</option>)}</select></label>
      <label><span>{l.language}</span><select value={docLanguage} onChange={e=>setDocLanguage(e.target.value as DocumentLanguage)}>
        {(Object.keys(l.languages) as DocumentLanguage[]).map(k=><option key={k} value={k}>{l.languages[k]}</option>)}</select></label>
      {fileField}
      <label><span>{l.summary}</span><input value={summary} maxLength={255} onChange={e=>setSummary(e.target.value)}/></label>
      <p className="wf-muted">{l.hint}</p>
      <div className="mk-actions"><button type="submit" className="btn btn-primary" disabled={busy||!title.trim()||!file}><Upload size={15}/>{busy?l.saving:l.save}</button>
        <button type="button" className="btn btn-secondary" onClick={reset}>{l.cancel}</button></div>
    </form>}
    {docs===null?null:docs.length===0?<p className="wf-muted">{l.none}</p>:
    <ul className="ct-list">{docs.map(doc=>{
      const current=doc.revisions[0];
      return <li key={doc.id}>
        <div className="ct-doc-head"><strong>{doc.title}</strong><span className="wf-status">{l.kinds[doc.kind]}</span>
          {doc.language&&<span className="ct-tag">{l.languages[doc.language]}</span>}</div>
        {current&&<p className="ct-current">{l.revision} {current.number} · {current.fileName} · {size(current.sizeBytes)} · {current.uploadedBy||"—"} · {stamp(current.uploadedAt)}
          <a className="text-action" href={revisionUrl(doc.id,current.number)} download={current.fileName}><Download size={14}/>{l.download}</a></p>}
        {doc.revisions.length>1&&<details><summary><History size={14}/> {l.history} ({doc.revisions.length-1})</summary>
          <ul className="wf-trail">{doc.revisions.slice(1).map(r=><li key={r.number}>{l.revision} {r.number} · {r.fileName}{r.changeSummary?` · ${r.changeSummary}`:""}
            <small>{r.uploadedBy||"—"} · {stamp(r.uploadedAt)} · <a href={revisionUrl(doc.id,r.number)} download={r.fileName}>{l.download}</a></small></li>)}</ul></details>}
        {reviseId===doc.id
          ?<form className="ct-form" onSubmit={e=>{e.preventDefault();void upload(doc);}}>
            {fileField}
            <label><span>{l.summary}</span><input value={summary} maxLength={255} onChange={e=>setSummary(e.target.value)}/></label>
            <div className="mk-actions"><button type="submit" className="btn btn-primary" disabled={busy||!file}><Upload size={15}/>{busy?l.saving:l.save}</button>
              <button type="button" className="btn btn-secondary" onClick={reset}>{l.cancel}</button></div>
          </form>
          :<div className="mk-actions">
            <button type="button" className="btn btn-secondary" onClick={()=>{reset();setReviseId(doc.id);}}><Upload size={15}/>{l.newRevision}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>archiveDocument(doc.id,doc.version))}><Archive size={15}/>{l.archive}</button>
          </div>}
      </li>;})}</ul>}
    <p className="wf-muted"><LockKeyhole size={13}/> {l.templates}</p>
  </section>;
}
