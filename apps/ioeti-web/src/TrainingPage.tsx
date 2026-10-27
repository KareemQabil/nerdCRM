import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleAlert, GraduationCap, LockKeyhole, Plus, UserMinus, UsersRound } from "lucide-react";
import {
  ApiError, cancelEnrollment, createTrainingCohort, createTrainingCourse, enrollTrainee, getAccountContacts,
  getAccounts, getCohortEnrollments, getCohortSessions, getSessionAttendance, getTrainingCohort,
  getTrainingCohorts, getTrainingCourses, recordAttendance, scheduleSession, setCohortState,
  type AccountSummary, type AttendanceStatus, type ContactSummary, type TrainingAttendance, type TrainingCohort,
  type TrainingCourse, type TrainingEnrollment, type TrainingSession,
} from "./api";
import type { Language } from "./preferences";
import { PageHeader } from "./ui";

const strings = {
  ar: {
    title:"التدريب الخارجي",desc:"الدورات والدفعات والتسجيل وقائمة الانتظار والحضور، ضمن صلاحياتك.",
    cohorts:"الدفعات",noCohorts:"لا توجد دفعات متاحة لك بعد",loading:"جار التحميل...",
    planned:"مخططة",open:"مفتوحة للتسجيل",closed:"مغلقة",seats:"المقاعد",confirmed:"مؤكد",waitlisted:"قائمة الانتظار",
    seatsLeft:"مقاعد متاحة",newCohort:"دفعة جديدة",newCourse:"دورة جديدة",course:"الدورة",chooseCourse:"اختر دورة",
    code:"الرمز",name:"الاسم",nameAr:"الاسم بالعربية",hours:"عدد الساعات",capacity:"السعة",minSeats:"الحد الأدنى",
    start:"تاريخ البدء",end:"تاريخ الانتهاء",location:"المكان",save:"حفظ",cancel:"إلغاء",
    openCohort:"فتح التسجيل",closeCohort:"إغلاق التسجيل",cancelCohort:"إلغاء الدفعة",
    trainees:"المتدربون",noTrainees:"لا يوجد متدربون بعد",sponsor:"الجهة الراعية",chooseSponsor:"اختر الجهة",
    trainee:"المتدرب",chooseTrainee:"اختر جهة الاتصال",enroll:"تسجيل",position:"الترتيب",cancelEnrollment:"إلغاء التسجيل",
    sessions:"الجلسات",noSessions:"لا توجد جلسات بعد",sessionTitle:"عنوان الجلسة",startsAt:"الموعد",minutes:"المدة بالدقائق",
    addSession:"إضافة جلسة",present:"حاضر",absent:"غائب",excused:"معتذر",attendance:"الحضور",
    certificate:"إصدار شهادة",policy:"الشهادات وإلغاء الدفعات والاسترداد متوقفة حتى اعتماد سياسة التدريب (D-03). لا تُسجَّل أرقام الهوية.",
    notOpen:"الدفعة ليست مفتوحة للتسجيل.",already:"هذا المتدرب مسجل بالفعل في الدفعة.",changed:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",
    invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
    state:"حالة الدفعة لا تسمح بهذا الإجراء.",onlyCoordinator:"منسّق الدفعة فقط يمكنه تعديلها.",
  },
  en: {
    title:"External training",desc:"Courses, cohorts, enrolment, waitlist and attendance, within your permissions.",
    cohorts:"Cohorts",noCohorts:"No cohorts available to you yet",loading:"Loading...",
    planned:"Planned",open:"Open for enrolment",closed:"Closed",seats:"Seats",confirmed:"Confirmed",waitlisted:"Waitlist",
    seatsLeft:"Seats left",newCohort:"New cohort",newCourse:"New course",course:"Course",chooseCourse:"Choose a course",
    code:"Code",name:"Name",nameAr:"Arabic name",hours:"Hours",capacity:"Capacity",minSeats:"Minimum seats",
    start:"Start date",end:"End date",location:"Location",save:"Save",cancel:"Cancel",
    openCohort:"Open enrolment",closeCohort:"Close enrolment",cancelCohort:"Cancel cohort",
    trainees:"Trainees",noTrainees:"No trainees yet",sponsor:"Sponsoring account",chooseSponsor:"Choose an account",
    trainee:"Trainee",chooseTrainee:"Choose a contact",enroll:"Enrol",position:"Position",cancelEnrollment:"Cancel enrolment",
    sessions:"Sessions",noSessions:"No sessions yet",sessionTitle:"Session title",startsAt:"Starts at",minutes:"Minutes",
    addSession:"Add session",present:"Present",absent:"Absent",excused:"Excused",attendance:"Attendance",
    certificate:"Issue certificate",policy:"Certificates, cohort cancellation and refunds wait for the training policy (D-03). No ID numbers are recorded.",
    notOpen:"This cohort is not open for enrolment.",already:"This trainee is already enrolled in the cohort.",changed:"The data changed elsewhere; it is refreshed, try again.",
    invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed.",
    state:"The cohort's state does not allow this action.",onlyCoordinator:"Only the cohort's coordinator can change it.",
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  if (error.code === "COHORT_NOT_OPEN") return l.notOpen;
  if (error.code === "ALREADY_ENROLLED") return l.already;
  if (error.code === "COHORT_STATE") return l.state;
  if (error.statusCode === 409) return l.changed;
  if (error.statusCode === 422 && error.fields.length) return l.invalid;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}

/** External training workspace (real mode). Each list is filtered by the server with the caller's permissions. */
export function TrainingPage({language}:{language:Language}){
  const l=strings[language];
  const [cohorts,setCohorts]=useState<TrainingCohort[]|null>(null);
  const [courses,setCourses]=useState<TrainingCourse[]>([]);
  const [selected,setSelected]=useState<TrainingCohort|null>(null);
  const [form,setForm]=useState<"cohort"|"course"|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    const [c,k]=await Promise.all([getTrainingCohorts(),getTrainingCourses()]);
    setCohorts(c);setCourses(k);
  },[]);
  useEffect(()=>{void load().catch(e=>{setCohorts([]);setError(message(e,l));});},[load,l]);
  async function run(action:()=>Promise<unknown>){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();}
    catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  const status=(c:TrainingCohort)=>c.status==="OPEN"?l.open:c.status==="CLOSED"?l.closed:l.planned;
  return <section className="page-enter training-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}/>
    <div className="training-toolbar">
      <button type="button" className="btn btn-primary" onClick={()=>setForm(form==="cohort"?null:"cohort")}><Plus size={16}/>{l.newCohort}</button>
      <button type="button" className="btn btn-secondary" onClick={()=>setForm(form==="course"?null:"course")}><Plus size={16}/>{l.newCourse}</button>
    </div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {form==="course"&&<CourseForm l={l} busy={busy} onCancel={()=>setForm(null)} onSave={body=>run(async()=>{await createTrainingCourse(body);setForm(null);await load();})}/>}
    {form==="cohort"&&<CohortForm l={l} busy={busy} courses={courses.filter(c=>c.active)} onCancel={()=>setForm(null)}
      onSave={body=>run(async()=>{const created=await createTrainingCohort(body);setForm(null);await load();setSelected(created);})}/>}
    <div className="training-layout">
      <div className="data-panel"><div className="data-panel-heading"><strong>{l.cohorts}</strong><span>{cohorts?.length??0}</span></div>
        {cohorts===null?<div className="empty-state" role="status">{l.loading}</div>
        :cohorts.length===0?<div className="empty-state">{l.noCohorts}</div>
        :<div className="directory-items">{cohorts.map(c=><button type="button" key={c.id}
          className={"directory-item training-cohort-row"+(selected?.id===c.id?" is-selected":"")} aria-pressed={selected?.id===c.id} onClick={()=>setSelected(c)}>
          <div className="line-monogram">{c.code.slice(0,2)}</div>
          <div className="directory-record"><strong>{(language==="ar"&&courses.find(k=>k.id===c.courseId)?.nameAr)||c.courseName}</strong><small><span dir="ltr">{c.code}</span> · {status(c)}</small></div>
          <span className="training-seats" dir="ltr">{c.confirmed}/{c.capacity}{c.waitlisted?` +${c.waitlisted}`:""}</span>
        </button>)}</div>}
      </div>
      {!selected&&cohorts!==null&&cohorts.length>0&&<div className="data-panel detail-placeholder" aria-hidden="true">
        <GraduationCap size={30}/><strong>{language==="ar"?"اختر دفعة من القائمة":"Choose a cohort"}</strong>
        <span>{language==="ar"?"لترى المقاعد وقائمة الانتظار والجلسات والحضور.":"to see seats, the waitlist, sessions and attendance."}</span></div>}
      {selected&&<CohortDetail key={selected.id} cohortId={selected.id} l={l} statusLabel={status}
        onChanged={updated=>{setSelected(updated);setCohorts(cur=>(cur||[]).map(c=>c.id===updated.id?updated:c));}}/>}
    </div>
  </section>;
}

function CourseForm({l,busy,onSave,onCancel}:{l:Labels;busy:boolean;onCancel:()=>void;
  onSave:(body:{code:string;name:string;nameAr?:string;durationHours?:number})=>void}){
  const [code,setCode]=useState("");const [name,setName]=useState("");const [nameAr,setNameAr]=useState("");const [hours,setHours]=useState("");
  return <form className="record-content-card opportunity-form training-form" onSubmit={e=>{e.preventDefault();
    onSave({code,name,...(nameAr?{nameAr}:{}),...(hours?{durationHours:Number(hours)}:{})});}}>
    <label><span>{l.code}</span><input required dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>
    <label><span>{l.name}</span><input required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label><span>{l.nameAr}</span><input dir="rtl" value={nameAr} onChange={e=>setNameAr(e.target.value)}/></label>
    <label><span>{l.hours}</span><input type="number" min="1" max="2000" value={hours} onChange={e=>setHours(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function CohortForm({l,busy,courses,onSave,onCancel}:{l:Labels;busy:boolean;courses:TrainingCourse[];onCancel:()=>void;
  onSave:(body:{courseId:number;code:string;capacity:number;minSeats?:number;startDate?:string;endDate?:string;location?:string})=>void}){
  const [courseId,setCourseId]=useState("");const [code,setCode]=useState("");const [capacity,setCapacity]=useState("20");
  const [minSeats,setMinSeats]=useState("");const [start,setStart]=useState("");const [end,setEnd]=useState("");const [location,setLocation]=useState("");
  return <form className="record-content-card opportunity-form training-form" onSubmit={e=>{e.preventDefault();
    onSave({courseId:Number(courseId),code,capacity:Number(capacity),...(minSeats?{minSeats:Number(minSeats)}:{}),
      ...(start?{startDate:start}:{}),...(end?{endDate:end}:{}),...(location?{location}:{})});}}>
    <label><span>{l.course}</span><select required value={courseId} onChange={e=>setCourseId(e.target.value)}>
      <option value="">{l.chooseCourse}</option>{courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><span>{l.code}</span><input required dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>
    <label><span>{l.capacity}</span><input required type="number" min="1" max="500" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
    <label><span>{l.minSeats}</span><input type="number" min="0" max={capacity} value={minSeats} onChange={e=>setMinSeats(e.target.value)}/></label>
    <label><span>{l.start}</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label><span>{l.end}</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label><span>{l.location}</span><input value={location} onChange={e=>setLocation(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy||!courseId}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function CohortDetail({cohortId,l,statusLabel,onChanged}:{cohortId:number;l:Labels;statusLabel:(c:TrainingCohort)=>string;
  onChanged:(c:TrainingCohort)=>void}){
  const [cohort,setCohort]=useState<TrainingCohort|null>(null);
  const [enrollments,setEnrollments]=useState<TrainingEnrollment[]>([]);
  const [sessions,setSessions]=useState<TrainingSession[]>([]);
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [contacts,setContacts]=useState<ContactSummary[]>([]);
  const [sponsor,setSponsor]=useState("");const [trainee,setTrainee]=useState("");
  const [title,setTitle]=useState("");const [startsAt,setStartsAt]=useState("");const [minutes,setMinutes]=useState("");
  const [activeSession,setActiveSession]=useState<number|null>(null);
  const [attendance,setAttendance]=useState<TrainingAttendance[]>([]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const reload=useCallback(async()=>{
    const [c,e,s]=await Promise.all([getTrainingCohort(cohortId),getCohortEnrollments(cohortId),getCohortSessions(cohortId)]);
    setCohort(c);setEnrollments(e);setSessions(s);onChanged(c);return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cohortId]);
  useEffect(()=>{void reload().catch(e=>setError(message(e,l)));void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[reload,l]);
  useEffect(()=>{setTrainee("");setContacts([]);if(sponsor)void getAccountContacts(Number(sponsor)).then(setContacts).catch(()=>setContacts([]));},[sponsor]);
  useEffect(()=>{setAttendance([]);if(activeSession!=null)void getSessionAttendance(activeSession).then(setAttendance).catch(()=>setAttendance([]));},[activeSession]);
  async function run(action:()=>Promise<unknown>){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();await reload();}
    catch(e){setError(message(e,l));void reload().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  if(!cohort)return <div className="record-content-card"><div className="empty-state" role="status">{l.loading}</div></div>;
  const editable=cohort.coordinatedByMe;
  const confirmed=enrollments.filter(e=>e.status==="CONFIRMED");
  const waiting=enrollments.filter(e=>e.status==="WAITLISTED");
  const session=sessions.find(s=>s.id===activeSession)||null;
  const mark=(enrollmentId:number,status:AttendanceStatus)=>void run(async()=>{
    const fresh=(await getCohortSessions(cohort.id)).find(s=>s.id===activeSession);
    if(!fresh)return;
    await recordAttendance(fresh.id,fresh.version,enrollmentId,status);
    setAttendance(await getSessionAttendance(fresh.id));
  });
  return <div className="training-detail">
    <section className="record-content-card" aria-labelledby="cohort-title">
      <div className="record-section-header"><div className="record-section-icon"><UsersRound size={20}/></div><div>
        <h2 id="cohort-title">{cohort.courseName} · <span dir="ltr">{cohort.code}</span></h2>
        <p>{statusLabel(cohort)}{cohort.location?` · ${cohort.location}`:""}{cohort.startDate?` · `:""}<span dir="ltr">{cohort.startDate}{cohort.endDate?` → ${cohort.endDate}`:""}</span></p>
      </div></div>
      <dl className="record-properties training-counts">
        <div><dt>{l.seats}</dt><dd>{cohort.capacity}</dd></div>
        <div><dt>{l.confirmed}</dt><dd>{cohort.confirmed}</dd></div>
        <div><dt>{l.waitlisted}</dt><dd>{cohort.waitlisted}</dd></div>
        <div><dt>{l.seatsLeft}</dt><dd>{cohort.seatsLeft}</dd></div>
      </dl>
      {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      <div className="lead-actions">
        {editable&&cohort.status==="PLANNED"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>setCohortState(cohort.id,cohort.version,"open"))}>{l.openCohort}</button>}
        {editable&&cohort.status==="OPEN"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setCohortState(cohort.id,cohort.version,"close"))}>{l.closeCohort}</button>}
        <button type="button" className="btn btn-secondary" disabled aria-describedby="training-policy">{l.cancelCohort}</button>
        <button type="button" className="btn btn-secondary" disabled aria-describedby="training-policy">{l.certificate}</button>
      </div>
      {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.onlyCoordinator}</p>}
      <p className="record-security-note" id="training-policy"><LockKeyhole size={15}/>{l.policy}</p>
    </section>

    <section className="record-content-card" aria-labelledby="trainees-title">
      <div className="record-section-header"><div className="record-section-icon"><GraduationCap size={20}/></div><div><h2 id="trainees-title">{l.trainees}</h2></div></div>
      {confirmed.length+waiting.length===0?<div className="empty-state">{l.noTrainees}</div>
      :<div className="table-scroll"><table><thead><tr><th>{l.trainee}</th><th>{l.sponsor}</th><th>{l.position}</th><th><span className="sr-only">{l.cancelEnrollment}</span></th></tr></thead>
        <tbody>{[...confirmed,...waiting].map(e=><tr key={e.id}>
          <td><strong>{e.traineeName||"—"}</strong></td><td>{e.clientName||"—"}</td>
          <td>{e.status==="CONFIRMED"?<span className="record-status-tag">{l.confirmed}</span>:<span className="training-waitlist">{l.waitlisted} #{e.waitlistPosition}</span>}</td>
          <td>{editable&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>cancelEnrollment(e.id,e.version))}><UserMinus size={15}/>{l.cancelEnrollment}</button>}</td>
        </tr>)}</tbody></table></div>}
      {editable&&cohort.status==="OPEN"&&<form className="opportunity-form training-form" onSubmit={ev=>{ev.preventDefault();
        void run(async()=>{await enrollTrainee(cohort.id,cohort.version,Number(trainee),sponsor?Number(sponsor):undefined);setTrainee("");});}}>
        <label><span>{l.sponsor}</span><select value={sponsor} onChange={e=>setSponsor(e.target.value)}>
          <option value="">{l.chooseSponsor}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span>{l.trainee}</span><select required value={trainee} onChange={e=>setTrainee(e.target.value)}>
          <option value="">{l.chooseTrainee}</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button type="submit" className="btn btn-primary" disabled={busy||!trainee}><Plus size={16}/>{l.enroll}</button>
      </form>}
    </section>

    <section className="record-content-card" aria-labelledby="sessions-title">
      <div className="record-section-header"><div className="record-section-icon"><CalendarClock size={20}/></div><div><h2 id="sessions-title">{l.sessions}</h2></div></div>
      {sessions.length===0?<div className="empty-state">{l.noSessions}</div>
      :<div className="segmented training-sessions" role="group" aria-label={l.sessions}>{sessions.map(s=><button key={s.id} type="button"
        className={activeSession===s.id?"chosen":""} aria-pressed={activeSession===s.id} onClick={()=>setActiveSession(s.id)}>
        {s.title} · <span dir="ltr">{s.startsAt.replace("T"," ").slice(0,16)}</span></button>)}</div>}
      {session&&<div className="table-scroll"><table aria-label={l.attendance}><thead><tr><th>{l.trainee}</th><th>{l.attendance}</th></tr></thead>
        <tbody>{confirmed.map(e=>{const current=attendance.find(a=>a.enrollmentId===e.id)?.status;
          return <tr key={e.id}><td>{e.traineeName||"—"}</td><td><div className="segmented" role="group" aria-label={(e.traineeName||"")+" "+l.attendance}>
            {(["PRESENT","ABSENT","EXCUSED"] as AttendanceStatus[]).map(st=><button key={st} type="button" disabled={busy||!editable}
              className={current===st?"chosen":""} aria-pressed={current===st} onClick={()=>mark(e.id,st)}>
              {st==="PRESENT"?l.present:st==="ABSENT"?l.absent:l.excused}</button>)}
          </div></td></tr>;})}</tbody></table></div>}
      {editable&&<form className="opportunity-form training-form" onSubmit={ev=>{ev.preventDefault();
        void run(async()=>{await scheduleSession(cohort.id,cohort.version,title,startsAt,minutes?Number(minutes):undefined);setTitle("");setStartsAt("");setMinutes("");});}}>
        <label><span>{l.sessionTitle}</span><input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label><span>{l.startsAt}</span><input required type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label>
        <label><span>{l.minutes}</span><input type="number" min="15" max="720" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addSession}</button>
      </form>}
    </section>
  </div>;
}
