/**
 * Fictional, in-memory scenario data for the public UI preview only.
 * This file is never consulted in connected Axelor mode. Records and edits are
 * deliberately NOT persisted. Never place real client names or secrets here.
 */
export const DEMO_AREAS = [
  "quotes","catalog","contracts","finance","projects","visits",
  "quality","marketing","learning","recruiting","certification","fundraising",
  "documents","automations","reports","admin"
] as const;
export type DemoArea = typeof DEMO_AREAS[number];
export type DemoStage = { ar:string; en:string };
export type DemoConfig = { ar:string; en:string; subtitleAr:string; subtitleEn:string;
  nounAr:string; nounEn:string; source:string; stages:readonly DemoStage[];
  actionAr:string; actionEn:string; safeguardsAr:string; safeguardsEn:string; unit?:string };
type Activity = {key:number; ar:string; en:string; date:string; author:string};
export type DemoRelation = {area:DemoArea; id:number};
export type DemoRecord = {
  id:number; area:DemoArea; titleAr:string; titleEn:string; company:string; owner:string; due:string;
  version:number; stage:number; value:number|null; currency:string; descriptionAr:string; descriptionEn:string;
  labels:string[]; links:DemoRelation[]; activities:Activity[];
};
const stages=(...pairs:[string,string][]):DemoStage[]=>pairs.map(([ar,en])=>({ar,en}));
export const demoConfigs:Record<DemoArea,DemoConfig>={
  quotes:{ar:"عروض الأسعار",en:"Quotations",subtitleAr:"بناء العرض وتسعيره ومراجعته حتى الاعتماد",subtitleEn:"Draft, price, review and approve service proposals",nounAr:"عرض سعر",nounEn:"quotation",source:"axelor-sale · SaleOrder",actionAr:"محاكاة انتقال العرض",actionEn:"Simulate next quote stage",safeguardsAr:"التسعير والموافقة والنسخ تحتاج تطبيق قواعد الخادم",safeguardsEn:"Pricing, approval and version checks require backend rules",unit:"EGP",stages:stages(["مسودة","Draft"],["مراجعة السعر","Price review"],["اعتماد الخصم","Discount approval"],["جاهز للإرسال","Ready to send"],["مقبول","Accepted"])},
  catalog:{ar:"كتالوج الخدمات",en:"Service catalog",subtitleAr:"الخدمات والتسعير والباقات حسب خط الأعمال",subtitleEn:"Services, price books and product delivery definitions",nounAr:"خدمة",nounEn:"service",source:"axelor-base · Product / PriceList",actionAr:"محاكاة تفعيل الخدمة",actionEn:"Simulate service activation",safeguardsAr:"قواعد التسعير الحقيقية والأهلية تتطلب تنفيذًا",safeguardsEn:"Real pricing and eligibility rules are not yet implemented",unit:"EGP",stages:stages(["قيد الإعداد","Setup"],["مراجعة المحتوى","Content review"],["مراجعة السعر","Pricing review"],["متاح","Active"])},
  contracts:{ar:"العقود والاتفاقيات",en:"Contracts & MOUs",subtitleAr:"الإصدارات والمراجعة والتوقيع والتجديد",subtitleEn:"Contract versions, legal review and signature gates",nounAr:"عقد",nounEn:"contract",source:"axelor-contract · Contract / ContractVersion",actionAr:"محاكاة مراجعة العقد",actionEn:"Simulate contract review",safeguardsAr:"التوقيعات والموافقات القانونية غير حقيقية",safeguardsEn:"Signatures and legal approval are not real",unit:"EGP",stages:stages(["مسودة","Draft"],["مراجعة قانونية","Legal review"],["انتظار التوقيع","Awaiting signature"],["ساري","Active"],["مراجعة التجديد","Renewal review"])},
  finance:{ar:"الفواتير والتحصيل",en:"Billing & collections",subtitleAr:"الاستحقاقات والفواتير والتحصيل، دون بيانات مالية حقيقية",subtitleEn:"Milestones, invoices and payment review using fictional data",nounAr:"استحقاق",nounEn:"milestone",source:"axelor-account · Invoice / Timetable",actionAr:"محاكاة التحصيل",actionEn:"Simulate collection",safeguardsAr:"لا توجد حركة بنكية أو فاتورة ضريبية فعلية",safeguardsEn:"No real bank settlement or tax invoice is issued",unit:"EGP",stages:stages(["مجدول","Scheduled"],["طلب فاتورة","Invoice requested"],["فاتورة تجريبية","Demo invoice"],["تحصيل جزئي","Partially collected"],["مقفل تجريبيًا","Demo closed"])},
  projects:{ar:"المشروعات والتسليم",en:"Projects & handover",subtitleAr:"نقل الصفقات للتشغيل وتوزيع المهام",subtitleEn:"Sales-to-operations handover, tasks and execution",nounAr:"مشروع",nounEn:"project",source:"axelor-project · Project / ProjectTask",actionAr:"محاكاة انتقال التنفيذ",actionEn:"Simulate delivery stage",safeguardsAr:"قبول التسليم ونقل الملكية يحتاجان منطقًا معتمدًا",safeguardsEn:"Real acceptance and ownership transfer are unimplemented",stages:stages(["بانتظار التسليم","Awaiting handover"],["استلام التشغيل","Operations intake"],["جدولة العمل","Planning"],["تنفيذ","In progress"],["مراجعة وتسليم","Acceptance"])},
  visits:{ar:"الزيارات الميدانية",en:"Field visits",subtitleAr:"التخطيط وقوائم التدقيق والأدلة الميدانية",subtitleEn:"Site planning, checklists and evidence capture",nounAr:"زيارة",nounEn:"visit",source:"axelor-intervention · Intervention",actionAr:"محاكاة حالة الزيارة",actionEn:"Simulate visit status",safeguardsAr:"الأدلة والتوقيعات في العرض تخيلية وغير معتمدة",safeguardsEn:"Evidence and signatures are fictional and unverified",stages:stages(["طلب زيارة","Requested"],["جدولة","Scheduled"],["في الموقع","On site"],["مراجعة الأدلة","Evidence review"],["مغلقة","Closed"])},
  quality:{ar:"الجودة والإجراءات التصحيحية",en:"Quality & CAPA",subtitleAr:"الملاحظات وتحليل الأسباب والإجراءات التصحيحية",subtitleEn:"Findings, analysis, corrective actions and review",nounAr:"ملاحظة",nounEn:"finding",source:"axelor-quality · QualityImprovement",actionAr:"محاكاة خطوة CAPA",actionEn:"Simulate CAPA stage",safeguardsAr:"المراجعة الخارجية المستقلة ليست متاحة بعد",safeguardsEn:"Independent external certification review is not connected",stages:stages(["ملاحظة مفتوحة","Open finding"],["تحليل السبب","Root cause"],["إجراء تصحيحي","Corrective action"],["تحقق","Verification"],["مغلقة","Closed"])},
  marketing:{ar:"التسويق والحملات",en:"Marketing campaigns",subtitleAr:"الحملات والجمهور والإسناد والتقارير",subtitleEn:"Campaign setup, target groups, lead attribution and reporting",nounAr:"حملة",nounEn:"campaign",source:"axelor-marketing · Campaign / TargetList",actionAr:"محاكاة حالة الحملة",actionEn:"Simulate campaign stage",safeguardsAr:"لا يتم إرسال أي رسائل أو إعلانات فعلية",safeguardsEn:"No real email, ads, or messages are sent",stages:stages(["فكرة","Idea"],["تصميم المحتوى","Creative review"],["جاهزة","Scheduled"],["تجريبية جارية","Demo running"],["مراجعة النتائج","Results review"])},
  learning:{ar:"التدريب الخارجي",en:"External training",subtitleAr:"البرامج والمجموعات والمتدربون والحضور والشهادات",subtitleEn:"Courses, cohorts, external learners, attendance and certificates",nounAr:"مجموعة تدريب",nounEn:"cohort",source:"axelor-talent reference + NEW IOETI external-training domain",actionAr:"محاكاة رحلة المجموعة",actionEn:"Simulate cohort step",safeguardsAr:"لا يوجد تسجيل مدفوع أو شهادات تدريب معتمدة",safeguardsEn:"No actual paid enrollments or valid certificates",stages:stages(["إعداد البرنامج","Program setup"],["فتح التسجيل","Enrollment open"],["تأكيد المجموعة","Cohort confirmed"],["التدريب جارٍ","In session"],["تقييم","Assessment"],["إصدار تجريبي","Demo issuance"])},
  recruiting:{ar:"التوظيف لصالح العملاء",en:"Client recruitment",subtitleAr:"طلبات العميل والمرشحون والمقابلات والتعيينات",subtitleEn:"Client job orders, consent, submissions, interviews and placement",nounAr:"طلب توظيف",nounEn:"job order",source:"axelor-talent reference + NEW ClientJobOrder domain",actionAr:"محاكاة رحلة التوظيف",actionEn:"Simulate recruitment step",safeguardsAr:"مشاركة السير الذاتية تتطلب موافقات حقيقية منفصلة",safeguardsEn:"Real candidate sharing requires separately enforced consent",stages:stages(["طلب العميل","Client brief"],["بحث ومطابقة","Sourcing"],["قائمة مختصرة","Shortlist"],["مقابلات","Interviews"],["عرض عمل","Offer"],["تعيين تجريبي","Demo placement"])},
  certification:{ar:"إدارة شهادات ISO",en:"ISO certification",subtitleAr:"دورة التدقيق والمخالفات والقرار المستقل والشهادة",subtitleEn:"Audit cycles, findings, impartial decisions and certificate lifecycle",nounAr:"دورة شهادة",nounEn:"certification cycle",source:"axelor-intervention/quality + NEW CertificationCycle",actionAr:"محاكاة مرحلة الشهادة",actionEn:"Simulate certification stage",safeguardsAr:"لا تُصدر أي شهادة ISO ولا يحاكي القرار اعتمادًا حقيقيًا",safeguardsEn:"No ISO certificate is issued or real certification decision made",stages:stages(["مراجعة النطاق","Scope review"],["Stage 1","Stage 1"],["Stage 2","Stage 2"],["إغلاق الملاحظات","CAPA closure"],["المراجعة المستقلة","Independent review"],["إصدار عرض تجريبي","Demo issue"])},
  documents:{ar:"المستندات والمعرفة",en:"Documents & knowledge",subtitleAr:"قوالب وإصدارات ومستندات العمليات ذات الصلاحيات",subtitleEn:"Record-scoped documents, templates and knowledge review",nounAr:"مستند",nounEn:"document",source:"axelor-base · MetaFile / PrintingTemplate",actionAr:"محاكاة مراجعة المستند",actionEn:"Simulate document review",safeguardsAr:"لا يتم تنزيل أو نشر مستند رسمي؛ الملفات خيالية",safeguardsEn:"No official document is published or downloaded",stages:stages(["مسودة","Draft"],["مراجعة المحتوى","Content review"],["مراجعة الصلاحيات","Access review"],["جاهز للنشر","Ready"],["مؤرشف تجريبيًا","Demo archived"])},
  automations:{ar:"الأتمتة والموافقات",en:"Automations & approvals",subtitleAr:"قواعد العمل وأحداث التشغيل والمراجعة والإصدار",subtitleEn:"Rule design, events, approvals and safe publishing preview",nounAr:"قاعدة أتمتة",nounEn:"automation",source:"Axelor Studio · WkfProcess / WkfDmnModel",actionAr:"محاكاة اعتماد القاعدة",actionEn:"Simulate automation policy",safeguardsAr:"لا يتم تشغيل أي Cron أو بريد أو Rule على الخادم",safeguardsEn:"No live cron, email or server-side rule is executed",stages:stages(["مسودة قاعدة","Rule draft"],["تجربة دون تنفيذ","Dry run"],["مراجعة المدير","Approval"],["نسخة جاهزة","Ready version"],["تفعيل تجريبي","Demo enabled"])},
  reports:{ar:"التحليلات والتقارير",en:"Analytics & reporting",subtitleAr:"تحليلات محكومة بالمصدر والدور وخط الأعمال",subtitleEn:"Source and role-scoped analysis with simulated indicators",nounAr:"تقرير",nounEn:"report",source:"CRM + Finance + Operations · NEW scoped projections",actionAr:"محاكاة اعتماد التقرير",actionEn:"Simulate report review",safeguardsAr:"لا توجد حسابات مالية فعلية أو تصدير بيانات شخصية",safeguardsEn:"No real finance calculations or personal data exports",stages:stages(["طلب تحليل","Requested"],["تحديد المقاييس","Metrics defined"],["تصفية الصلاحيات","Access filtering"],["مراجعة النتائج","Results review"],["جاهز كمعاينة","Preview ready"])},
  admin:{ar:"إدارة النظام وخطوط الأعمال",en:"Administration",subtitleAr:"الأدوار والصلاحيات والتكوين المعياري للعمليات",subtitleEn:"Role policies, business-line configuration and deployment controls",nounAr:"إعداد",nounEn:"configuration",source:"Axelor Studio · MetaJsonModel / WkfProcess + IOETI",actionAr:"محاكاة نشر الإعداد",actionEn:"Simulate configuration approval",safeguardsAr:"لا تعدل صلاحيات المستخدمين أو البيانات التشغيلية بالفعل",safeguardsEn:"No real user permission, backend configuration or data changes",stages:stages(["مسودة إعداد","Configuration draft"],["تدقيق التأثير","Impact review"],["مراجعة الصلاحيات","Access review"],["اعتماد تجريبي","Demo approval"],["معاينة منشورة","Preview published"])},
  fundraising:{ar:"تنمية الموارد",en:"Fundraising & grants",subtitleAr:"المانحون والمنح والتعهدات والتحصيل والتقارير",subtitleEn:"Donor relationships, proposals, pledges and verified collection",nounAr:"ملف تمويل",nounEn:"funding case",source:"axelor-crm reference + NEW Donor/Grant/Pledge",actionAr:"محاكاة رحلة التمويل",actionEn:"Simulate funding step",safeguardsAr:"التعهد ليس إيرادًا نقديًا ولا توجد إيصالات فعلية",safeguardsEn:"A pledge is not collected revenue; no real receipts are made",unit:"EGP",stages:stages(["بحث عن مانح","Prospecting"],["تواصل","Outreach"],["مقترح","Proposal"],["تعهد تجريبي","Demo pledge"],["إيصال تجريبي","Demo receipt"],["متابعة الأثر","Stewardship"])}
};
function item(area:DemoArea,id:number,ar:string,en:string,company:string,stage:number,owner:string,amount:number|null,links:DemoRelation[]=[]):DemoRecord {
  return {area,id,titleAr:ar,titleEn:en,company,owner,stage,version:1,value:amount,currency:"EGP",
    due:"2026-11-"+String((id%19)+6).padStart(2,"0"),links,labels:[],
    descriptionAr:"سيناريو تجريبي يوضح سياق العملية والانتقال بين مراحلها. لا يعكس سجل عميل فعلي.",
    descriptionEn:"Fictional scenario demonstrating the task and its stage transitions. This is not a real client record.",
    activities:[{key:id*10,ar:"تم إنشاء السيناريو ضمن بيانات المعاينة",en:"Scenario loaded as fictional preview data",date:"2026-10-19",author:"Demo Seed"}]};
}
const seeds:DemoRecord[]=[
  item("quotes",4101,"عرض اعتماد فندق نايل فيو","Nile View hotel certification proposal","Nile View Hotel",2,"منى أحمد",148000,[{area:"contracts",id:5101},{area:"certification",id:1101}]),
  item("quotes",4102,"برنامج تدريب مشرفي الأغذية","Food supervisors training proposal","Delta Foods",1,"طارق يوسف",84000,[{area:"learning",id:9101}]),
  item("quotes",4103,"خدمة توظيف مهندسي الجودة","Quality engineers placement proposal","Cairo Manufacturing",0,"منة حسن",92000,[{area:"recruiting",id:10101}]),
  item("catalog",4201,"تدقيق ISO 9001","ISO 9001 audit service","IOETI Service Library",3,"إدارة الجودة",65000),
  item("catalog",4202,"دورة سلامة الغذاء","Food safety training","IOETI Service Library",2,"إدارة التدريب",7200),
  item("catalog",4203,"خدمة توظيف الكوادر","Talent placement service","IOETI Service Library",1,"إدارة التوظيف",18000),
  item("contracts",5101,"اتفاقية خدمات تدقيق الفندق","Hotel audit service agreement","Nile View Hotel",2,"المراجعة القانونية",148000,[{area:"quotes",id:4101},{area:"projects",id:7101}]),
  item("contracts",5102,"اتفاق تدريب شركة دلتا","Delta corporate learning contract","Delta Foods",3,"المراجعة القانونية",84000,[{area:"learning",id:9101}]),
  item("contracts",5103,"مذكرة تعاون جامعة المستقبل","Future University partnership MOU","Future University",1,"إدارة الشراكات",null,[{area:"fundraising",id:1201}]),
  item("finance",6101,"استحقاق بداية تدقيق الفندق","Hotel audit kickoff milestone","Nile View Hotel",2,"فريق المالية",52000,[{area:"contracts",id:5101}]),
  item("finance",6102,"قسط برنامج التدريب","Training cohort installment","Delta Foods",3,"فريق المالية",28000,[{area:"learning",id:9101}]),
  item("finance",6103,"استحقاق توظيف","Recruitment placement milestone","Cairo Manufacturing",0,"فريق المالية",34000,[{area:"recruiting",id:10101}]),
  item("projects",7101,"تشغيل مشروع اعتماد الفندق","Hotel certification delivery project","Nile View Hotel",2,"مدير العمليات",null,[{area:"contracts",id:5101},{area:"visits",id:8101}]),
  item("projects",7102,"تنفيذ التدريب لشركة دلتا","Delta corporate training delivery","Delta Foods",3,"مدير البرامج",null,[{area:"learning",id:9101}]),
  item("projects",7103,"تسليم خدمات الدعم الميداني","Field support project handover","Cairo Hospitality",0,"مدير العمليات",null,[{area:"visits",id:8102}]),
  item("visits",8101,"زيارة تدقيق المرحلة الأولى","Stage 1 audit field visit","Nile View Hotel",1,"أحمد الخبير",null,[{area:"certification",id:1101},{area:"projects",id:7101}]),
  item("visits",8102,"زيارة متابعة الجودة","Quality follow-up visit","Cairo Hospitality",2,"نهى فؤاد",null,[{area:"quality",id:8201}]),
  item("visits",8103,"زيارة تقييم موقع المصنع","Food factory site evaluation","Delta Foods",0,"محمود علي",null,[{area:"certification",id:1102}]),
  item("quality",8201,"ملاحظة توثيق إجراءات الاستقبال","Reception process documentation finding","Cairo Hospitality",2,"مراجع الجودة",null,[{area:"visits",id:8102}]),
  item("quality",8202,"إغلاق إجراءات فحص الغذاء","Food inspection corrective action","Delta Foods",3,"مراجع الجودة",null,[{area:"certification",id:1102}]),
  item("quality",8203,"تحسين إدارة المخاطر","Risk management quality action","Nile View Hotel",1,"مراجع الجودة",null,[{area:"certification",id:1101}]),
  item("marketing",8301,"حملة توعية ISO 9001","ISO 9001 awareness campaign","IOETI Marketing",3,"فريق التسويق",24000),
  item("marketing",8302,"الإعلان عن برنامج التدريب","Training cohort launch campaign","IOETI Marketing",2,"فريق التسويق",12000,[{area:"learning",id:9101}]),
  item("marketing",8303,"شراكات القطاع الصناعي","Industrial partnerships campaign","IOETI Marketing",1,"إدارة الشراكات",15000,[{area:"fundraising",id:1202}]),
  item("learning",9101,"مجموعة سلامة الأغذية — نوفمبر","Food safety November cohort","Delta Foods",2,"منسق التدريب",84000,[{area:"contracts",id:5102},{area:"projects",id:7102}]),
  item("learning",9102,"برنامج مهارات المدقق الداخلي","Internal auditor skills cohort","Nile View Hotel",3,"منسق التدريب",54000,[{area:"certification",id:1101}]),
  item("learning",9103,"برنامج مهارات التواصل المهني","Professional communication cohort","Future University",1,"منسق التدريب",22000),
  item("recruiting",10101,"طلب مهندسي جودة للعميل","Client quality engineer job order","Cairo Manufacturing",2,"أخصائي التوظيف",92000,[{area:"quotes",id:4103},{area:"finance",id:6103}]),
  item("recruiting",10102,"طلب مسؤول موارد بشرية","HR officer job order","Nile View Hotel",3,"أخصائي التوظيف",38000),
  item("recruiting",10103,"طلب فني سلامة غذاء","Food safety technician order","Delta Foods",1,"أخصائي التوظيف",47000),
  item("certification",1101,"دورة ISO 9001 — فندق نايل فيو","ISO 9001 cycle — Nile View Hotel","Nile View Hotel",1,"منسق الشهادات",null,[{area:"visits",id:8101},{area:"projects",id:7101},{area:"quotes",id:4101}]),
  item("certification",1102,"دورة ISO 22000 — دلتا للأغذية","ISO 22000 cycle — Delta Foods","Delta Foods",2,"منسق الشهادات",null,[{area:"visits",id:8103},{area:"quality",id:8202}]),
  item("certification",1103,"مراجعة تجديد شهادة مصنع تجريبي","Factory recertification scenario","Cairo Manufacturing",4,"منسق الشهادات",null),
  item("fundraising",1201,"برنامج دعم التعليم المهني","Vocational education partnership grant","Future University",2,"مسؤول تنمية الموارد",150000,[{area:"contracts",id:5103}]),
  item("fundraising",1202,"منحة رفع كفاءة المؤسسات","Institutional capacity-building grant","Industry Development Foundation",3,"مسؤول المنح",300000),
  item("fundraising",1203,"شراكة تدريب مجتمعي","Community training sponsorship","Delta Foods",1,"مسؤول الشراكات",60000,[{area:"learning",id:9103}]),
  item("documents",13001,"قالب شهادة التدريب","Training certificate bilingual template","IOETI Knowledge",2,"محرر المستندات",null,[{area:"learning",id:9101}]),
  item("documents",13002,"نسخة اتفاقية العميل","Customer contract version","IOETI Knowledge",1,"الفريق القانوني",null,[{area:"contracts",id:5101}]),
  item("documents",13003,"إجراء حفظ أدلة التدقيق","Audit evidence retention SOP","IOETI Knowledge",3,"مسؤول الجودة",null,[{area:"certification",id:1101}]),
  item("automations",13101,"قاعدة تنبيه انتهاء العقد","Contract renewal notification rule","IOETI Automation",2,"مسؤول العمليات",null,[{area:"contracts",id:5101}]),
  item("automations",13102,"تحويل Lead مع SLA","Lead assignment with SLA","IOETI Automation",1,"مسؤول CRM",null),
  item("automations",13103,"إشعار تأخر التعهد","Pledge follow-up reminder","IOETI Automation",3,"مسؤول الشراكات",null,[{area:"fundraising",id:1201}]),
  item("reports",13201,"تقرير تحويل الفرص التجارية","Sales opportunity conversion scorecard","IOETI Analytics",2,"محلل الأعمال",null,[{area:"quotes",id:4101}]),
  item("reports",13202,"تقرير المراقبة السنوية ISO","Certification surveillance overview","IOETI Analytics",3,"مدير الجودة",null,[{area:"certification",id:1101}]),
  item("reports",13203,"التعهدات مقابل المحصل","Pledges versus collected scenario","IOETI Analytics",1,"مسؤول المالية",null,[{area:"fundraising",id:1202}]),
  item("admin",13301,"إعداد Pipeline شهادات ISO","ISO stage template configuration","IOETI Administration",2,"مدير النظام",null,[{area:"certification",id:1101}]),
  item("admin",13302,"مصفوفة صلاحيات فريق المبيعات","Sales team role policy review","IOETI Administration",1,"مسؤول الحوكمة",null),
  item("admin",13303,"تكوين خطوط الأعمال الجديدة","Business line configurator","IOETI Administration",0,"مدير النظام",null)
];
let records=seeds.map(r=>({...r,labels:[...r.labels],links:[...r.links],activities:[...r.activities]}));
let revision=0;
const listeners=new Set<()=>void>();
function changed(){revision+=1;for(const listener of listeners)listener();}
function locate(area:DemoArea,id:number){return records.find(x=>x.area===area&&x.id===id);}
let nextId=14000;let nextActivity=300000;
function assertEditable(area:DemoArea,id:number,version:number){const row=locate(area,id);if(!row)throw Error("Unknown demo scenario");if(row.version!==version)throw Error("The demo scenario was changed: reload before retrying");return row;}
export const demoBusinessStore={
  subscribe(callback:()=>void){listeners.add(callback);return()=>{listeners.delete(callback);};},
  getRevision(){return revision;},
  list(area:DemoArea){return records.filter(x=>x.area===area);},
  get(area:DemoArea,id:number){return locate(area,id);},
  create(area:DemoArea,title:string,company:string,value:number|null){
    if(title.trim().length<3||company.trim().length<3)throw Error("A name and organization are required");
    const id=nextId++;
    const record=item(area,id,title.trim(),title.trim(),company.trim(),0,"Demo guest",value);
    records=[record,...records];changed();return record;
  },
  transition(area:DemoArea,id:number,expectedVersion:number,rationale:string){
    const row=assertEditable(area,id,expectedVersion),max=demoConfigs[area].stages.length-1;
    if(row.stage>=max)throw Error("This scenario is already at its final demo stage");
    if(rationale.trim().length<8)throw Error("Provide a meaningful review note of at least 8 characters");
    const next={...row,stage:row.stage+1,version:row.version+1,activities:[{
      key:nextActivity++,ar:"انتقال تجريبي إلى: "+demoConfigs[area].stages[row.stage+1].ar+" — "+rationale.trim(),
      en:"Demo transition to: "+demoConfigs[area].stages[row.stage+1].en+" — "+rationale.trim(),author:"Preview guest",date:"2026-10-19"},...row.activities]};
    records=records.map(x=>x===row?next:x);changed();return next;
  },
  comment(area:DemoArea,id:number,expectedVersion:number,note:string){
    const row=assertEditable(area,id,expectedVersion);
    if(note.trim().length<3)throw Error("Enter a note");
    const updated={...row,version:row.version+1,activities:[{key:nextActivity++,ar:note.trim(),en:note.trim(),author:"Preview guest",date:"2026-10-19"},...row.activities]};
    records=records.map(x=>x===row?updated:x);changed();return updated;
  },
  reset(){records=seeds.map(r=>({...r,labels:[],links:[...r.links],activities:[...r.activities]}));nextId=14000;nextActivity=300000;changed();}
};
