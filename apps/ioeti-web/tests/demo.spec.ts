import { expect, test } from "@playwright/test";
const moduleRoutes=["quotes","catalog","contracts","finance","projects","visits","quality","marketing","training","recruitment","certification","fundraising","documents","automations","reports","settings"];
test("all sixteen fictional business workspaces open real page flows, not drawers",async ({page})=>{
  for(const area of moduleRoutes){
    const route=["training","recruitment","certification","fundraising","settings"].includes(area)?"#/"+area:"#/demo/"+area;
    await page.goto("/"+route);
    await expect(page.locator(".demo-workspace-heading h1")).toBeVisible();
    await expect(page.locator(".demo-record-row")).toHaveCount(3);
    await expect(page.locator(".demo-isolation-chip")).toContainText("غير متصل");
    await page.locator(".demo-record-row").first().click();
    await expect(page.locator(".demo-record-hero h1")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".demo-record-hero")).toContainText("DEMO");
    await page.getByRole("button",{name:"الرجوع للسجل"}).click();
    await expect(page.locator(".demo-workspace-heading")).toBeVisible();
  }
});
test("quote-to-contract-to-operations uses actual crosslinked fictional route transitions",async ({page})=>{
  await page.goto("/#/demo/quotes/4101");
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-4101");
  await page.getByRole("tab",{name:"العلاقات"}).click();
  await page.getByRole("button",{name:/اتفاقية خدمات تدقيق الفندق/}).click();
 await expect(page).toHaveURL(new RegExp("contracts/5101$"));
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-5101");
  await page.getByRole("tab",{name:"العلاقات"}).click();
  await page.getByRole("button",{name:/تشغيل مشروع اعتماد الفندق/}).click();
  await expect(page).toHaveURL(/#\/demo\/projects\/7101$/);
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-7101");
});
test("high stakes status change requires review note, explicit simulation confirmation and creates activity",async ({page})=>{
  await page.goto("/#/certification/1101");
  const hero=page.locator(".demo-record-hero");
  await expect(hero).toContainText("Stage 1");
  await page.getByRole("button",{name:"محاكاة المرحلة التالية"}).click();
  const dlg=page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button",{name:"اكمل الرحلة التجريبية"})).toBeDisabled();
  await dlg.getByRole("textbox",{name:"ملاحظة المراجعة"}).fill("محاكاة اختبار مراحل تدقيق افتراضي");
  await dlg.getByRole("checkbox").check();
  await dlg.getByRole("button",{name:"اكمل الرحلة التجريبية"}).click();
  await expect(dlg).toHaveCount(0);
  await expect(hero).toContainText("Stage 2");
  await page.getByRole("tab",{name:"الأنشطة"}).click();
  await expect(page.getByRole("tabpanel")).toContainText("محاكاة اختبار مراحل تدقيق افتراضي");
});
test("scenario creation is in-memory and resets on reload",async ({page})=>{
  await page.goto("/#/demo/quotes");
  await page.getByRole("button",{name:"سيناريو جديد"}).click();
  const dlg=page.getByRole("dialog");
  await dlg.getByRole("textbox",{name:"عنوان السجل"}).fill("عرض تجريبي جديد بالكامل");
  await dlg.getByRole("textbox",{name:"الجهة (خيالية)"}).fill("شركة تجريبية خيالية");
  await dlg.getByRole("spinbutton",{name:"قيمة تجريبية (اختياري)"}).fill("32500");
  await dlg.getByRole("button",{name:"احفظ داخل المعاينة"}).click();
  await expect(page.locator(".demo-record-hero h1")).toHaveText("عرض تجريبي جديد بالكامل");
  await expect(page.locator(".demo-record-facts")).toContainText("EGP");
  await page.reload();
  await expect(page.locator(".demo-record-hero h1")).toHaveCount(0);
  await expect(page.getByText("عرض تجريبي جديد بالكامل")).toHaveCount(0);
});
test("English, desktop themes and responsive mobile all remain in the original shell",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/#/training");
  await expect(page.locator(".side-panel")).toHaveCount(1);
  await expect(page.locator(".demo-record-row")).toHaveCount(3);
  await page.getByRole("button",{name:"اللغة"}).click();
  await expect(page.locator("html")).toHaveAttribute("dir","ltr");
  await expect(page.locator(".demo-workspace-heading h1")).toHaveText("External training");
  await expect(page.locator(".demo-record-row")).toHaveCount(3);
  await page.locator(".demo-record-row").first().click();
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-9101");
  await page.screenshot({path:"test-results/ioeti-demo-training-mobile.png",fullPage:true});
});
test("public demo must never call real Axelor backend during cross-module interactions",async ({page})=>{
  const calls:string[]=[];
  page.on("request",req=>{if(req.url().includes("/axelor-erp/"))calls.push(req.url());});
  await page.goto("/#/demo/quotes/4101");
  await page.getByRole("tab",{name:"العلاقات"}).click();
  await page.getByRole("button",{name:/اتفاقية خدمات تدقيق الفندق/}).click();
  await page.getByRole("button",{name:"أضف ملاحظة تجريبية"}).click();
  await page.getByRole("dialog").getByRole("textbox",{name:"ملاحظة المراجعة"}).fill("فقط ضمن معاينة المستخدم");
  await page.getByRole("dialog").getByRole("button",{name:"احفظ داخل المعاينة"}).click();
  expect(calls).toEqual([]);
});

test("specialized quotation workbench computes only fictional price previews",async ({page})=>{
 await page.goto("/#/demo/quotes/4101");
 const board=page.getByRole("region",{name:"تجربة عملية داخل الملف"});
 await expect(board).toBeVisible();
 await board.getByRole("spinbutton",{name:"وحدات الخدمة"}).fill("3");
 await board.getByRole("spinbutton",{name:"نسبة الخصم التجريبية"}).fill("10");
 await expect(board).toContainText("11,340 EGP");
 await expect(board).toContainText("قواعد الضريبة");
});
test("ISO evidence gate and training attendance are interactive but never issue credentials",async ({page})=>{
 await page.goto("/#/certification/1101");
 const iso=page.getByRole("region",{name:"تجربة عملية داخل الملف"});
 await expect(iso.getByRole("checkbox")).toHaveCount(6);
 await iso.getByRole("checkbox").first().check();
 await expect(iso).toContainText("1/6");
 await expect(iso).toContainText("إصدار الشهادة قرار مستقل");
 await page.goto("/#/training/9101");
 const training=page.getByRole("region",{name:"تجربة عملية داخل الملف"});
 await expect(training).toContainText("6/12");
 await training.getByRole("checkbox").first().check();
 await expect(training).toContainText("17%");
 await training.getByRole("button",{name:"مقعد افتراضي إضافي"}).click();
 await expect(training).toContainText("7/12");
});
test("fundraising preview distinguishes pledged from collected cash and recruitment requires mock consent",async ({page})=>{
 await page.goto("/#/fundraising/1201");
 const pledge=page.getByRole("region",{name:"تجربة عملية داخل الملف"});
 await expect(pledge).toContainText("150,000 EGP");
 await pledge.getByRole("spinbutton",{name:"مبلغ محصل للمحاكاة (EGP)"}).fill("2500");
 await pledge.getByRole("button",{name:"سجل تحصيلًا تجريبيًا"}).click();
 await expect(pledge).toContainText("2,500 EGP");
 await page.goto("/#/recruitment/10101");
 const hiring=page.getByRole("region",{name:"تجربة عملية داخل الملف"});
 const candidates=hiring.getByRole("checkbox");
 await expect(candidates).toHaveCount(5);
 await expect(candidates.nth(1)).toBeDisabled();
 await candidates.first().check();
 await expect(candidates.nth(1)).toBeEnabled();
 await candidates.nth(1).check();
 await expect(hiring).toContainText("1");
});


test("pipeline board groups fictional records by stage and keeps full record navigation",async ({page})=>{
 await page.goto("/#/demo/quotes");
 await expect(page.locator(".demo-record-row")).toHaveCount(3);
 await page.getByRole("button",{name:"لوحة المراحل"}).click();
 const board=page.getByTestId("demo-pipeline-board");
 await expect(board).toBeVisible();
 await expect(board.locator(".demo-board-column")).toHaveCount(5);
 await expect(board.locator(".demo-board-card")).toHaveCount(3);
 await page.screenshot({path:"test-results/ioeti-quote-pipeline-arabic-desktop.png",fullPage:true});
 await board.locator(".demo-board-card").first().click();
 await expect(page.locator(".demo-record-hero h1")).toBeVisible();
 await page.getByRole("button",{name:"الرجوع للسجل"}).click();
 await page.getByRole("button",{name:"قائمة"}).click();
 await expect(page.locator(".demo-record-row")).toHaveCount(3);
 await expect(board).toHaveCount(0);
});
test("pipeline shares stage/search filters and supports slash-to-search keyboard access",async ({page})=>{
 await page.goto("/#/demo/quotes");
 await expect(page.locator(".demo-workspace-heading h1")).toBeVisible();
 await page.keyboard.press("/");
 const search=page.getByRole("textbox",{name:"ابحث في السجلات التجريبية"});
 await expect(search).toBeFocused();
 await search.fill("Nile View");
 await page.getByRole("button",{name:"لوحة المراحل"}).click();
 const board=page.getByTestId("demo-pipeline-board");
 await expect(board.locator(".demo-board-card")).toHaveCount(1);
 await page.getByRole("combobox",{name:"المرحلة"}).selectOption("2");
 await expect(board.locator(".demo-board-card")).toHaveCount(1);
 await page.getByRole("combobox",{name:"المرحلة"}).selectOption("1");
 await expect(board).toHaveCount(0);
 await expect(page.getByText("لا توجد سيناريوهات مطابقة للبحث")).toBeVisible();
});
test("pipeline uses English LTR and horizontal mobile scrolling inside the workspace",async ({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/#/training");
 await page.getByRole("button",{name:"اللغة"}).click();
 await expect(page.locator("html")).toHaveAttribute("dir","ltr");
 await page.getByRole("button",{name:"Pipeline board"}).click();
 const board=page.getByTestId("demo-pipeline-board");
 await expect(board.locator(".demo-board-column")).toHaveCount(6);
 await expect(board.locator(".demo-board-card")).toHaveCount(3);
 await expect(page.locator("body")).toHaveJSProperty("scrollWidth",390);
 await page.screenshot({path:"test-results/ioeti-training-pipeline-english-mobile.png",fullPage:true});
});


test("RTL record tabs support arrow navigation, Home, End and linked panel semantics",async ({page})=>{
 await page.goto("/#/demo/quotes/4101");
 const overview=page.getByRole("tab",{name:"نظرة عامة"});
 await expect(overview).toBeVisible();
 await overview.focus();
 await page.keyboard.press("ArrowLeft");
 const activity=page.getByRole("tab",{name:"الأنشطة"});
 await expect(activity).toBeFocused();
 await expect(activity).toHaveAttribute("aria-selected","true");
 await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby","demo-tab-quotes-timeline");
 await page.keyboard.press("End");
 await expect(page.getByRole("tab",{name:"العلاقات"})).toBeFocused();
 await page.keyboard.press("Home");
 await expect(overview).toBeFocused();
});
test("cross-domain navigation resets previous register filters without changing source records",async ({page})=>{
 await page.goto("/#/demo/quotes");
 await expect(page.locator(".demo-record-row")).toHaveCount(3);
 await page.getByRole("textbox",{name:"ابحث في السجلات التجريبية"}).fill("Nile View");
 await expect(page.locator(".demo-record-row")).toHaveCount(1);
 await page.locator(".demo-record-row").first().click();
 await page.getByRole("tab",{name:"العلاقات"}).click();
 await page.getByRole("button",{name:/اتفاقية خدمات تدقيق الفندق/}).click();
  await expect(page).toHaveURL(new RegExp("contracts/5101$"));
 await page.getByRole("button",{name:"الرجوع للسجل"}).click();
 await expect(page.locator(".demo-record-row")).toHaveCount(3);
 await expect(page.getByRole("textbox",{name:"ابحث في السجلات التجريبية"})).toHaveValue("");
});


test("guided ISO journey starts at a linked fictional quote and never calls Axelor",async ({page})=>{
  const axelor:string[]=[];
  page.on("request",req=>{if(req.url().includes("/axelor-erp/"))axelor.push(req.url());});
  await page.goto("/#/home");
  const journey=page.locator(".demo-tour");
  await expect(journey.getByRole("heading",{name:"جرّب النظام كرحلة عمل كاملة"})).toBeVisible();
  await expect(journey.getByRole("list",{name:"خطوات الرحلة"}).locator("li")).toHaveCount(6);
  await journey.getByRole("button",{name:"ابدأ الرحلة"}).click();
  await expect(page).toHaveURL(/#\/demo\/quotes\/4101$/);
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-4101");
  expect(axelor).toEqual([]);
});

test("guided journeys switch across training, recruitment and grants using existing sample records",async ({page})=>{
  await page.goto("/#/home");
  const guided=page.locator(".demo-tour");
  await guided.getByRole("button",{name:"برنامج تدريب مؤسسي"}).click();
  await expect(guided.getByRole("listitem")).toHaveCount(5);
  await guided.getByRole("button",{name:"افتح المجموعة التدريبية"}).click();
  await expect(page).toHaveURL(/#\/training\/9101$/);
  await page.goto("/#/home");
  await guided.getByRole("button",{name:"التوظيف لصالح عميل"}).click();
  await expect(guided.getByRole("listitem")).toHaveCount(3);
  await guided.getByRole("button",{name:"افتح طلب توظيف العميل"}).click();
  await expect(page).toHaveURL(/#\/recruitment\/10101$/);
  await page.goto("/#/home");
  await guided.getByRole("button",{name:"الشراكات والمنح"}).click();
  await guided.getByRole("button",{name:"افتح تقرير التحصيل"}).click();
  await expect(page).toHaveURL(/#\/demo\/reports\/13203$/);
});

test("guided journeys are readable in English LTR on a narrow mobile viewport",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/#/home");
  await page.getByRole("button",{name:"اللغة"}).click();
  await expect(page.locator("html")).toHaveAttribute("dir","ltr");
  const journey=page.locator(".demo-tour");
  await expect(journey.getByRole("heading",{name:"Explore an end-to-end business journey"})).toBeVisible();
  await journey.getByRole("button",{name:"Partnerships and grants"}).click();
  await expect(journey.getByRole("listitem")).toHaveCount(3);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth",390);
  await journey.getByRole("button",{name:"Open Grant record"}).click();
  await expect(page).toHaveURL(/#\/fundraising\/1202$/);
});


test("focus mission isolates one step, gives accessible progress and restores page on Escape", async ({page}) => {
  const calls:string[] = [];
  page.on("request",request => {if(request.url().includes("/axelor-erp/")) calls.push(request.url());});
  await page.goto("/#/home");
  const trigger=page.getByRole("button",{name:"وضع التركيز"});
  await trigger.click();
  const dialog=page.getByRole("dialog",{name:"عرض السعر"});
  await expect(dialog).toBeVisible();
  await expect(page.locator("#root")).toHaveJSProperty("inert",true);
  await expect(dialog.getByRole("progressbar",{name:"تقدم الرحلة"})).toHaveAttribute("aria-valuenow","1");
  await dialog.getByRole("button",{name:"التالي"}).click();
  await expect(page.getByRole("dialog",{name:"العقد"})).toBeVisible();
  await expect(page.getByRole("progressbar",{name:"تقدم الرحلة"})).toHaveAttribute("aria-valuenow","2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("demo-mission-overlay")).toHaveCount(0);
  await expect(page.locator("#root")).toHaveJSProperty("inert",false);
  await expect(trigger).toBeFocused();
  expect(calls).toEqual([]);
});

test("focus mission opens chosen record and does not simulate a backend action", async ({page}) => {
  await page.goto("/#/home");
  await page.getByRole("button",{name:"وضع التركيز"}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByRole("button",{name:/تدقيق ISO/}).click();
  await dialog.getByRole("button",{name:"افتح الملف واشتغل عليه"}).click();
  await expect(page).toHaveURL(new RegExp("certification/1101$"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".demo-record-hero")).toContainText("DEMO-1101");
});

test("focus mission mobile supports swipe, English and reduced-motion preferences", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/#/home");
  await page.getByRole("button",{name:"اللغة"}).click();
  await page.getByRole("button",{name:"Enter focus mode"}).click();
  const dialog=page.getByRole("dialog",{name:"Quotation"});
  await expect(dialog).toBeVisible();
  await expect(page.locator(".mission-dialog")).toHaveCSS("animation-name","none");
  await expect(page.getByRole("progressbar",{name:"Journey progress"})).toHaveAttribute("aria-valuenow","1");
  const area=dialog.locator(".mission-illustration");
  const box=await area.boundingBox();
  if(!box) throw new Error("Missing gesture target");
  await page.dispatchEvent(".mission-work-area","touchstart",{
    touches:[{identifier:1,clientX:box.x+box.width-30,clientY:box.y+40,target:area}],
  });
  await page.dispatchEvent(".mission-work-area","touchend",{
    changedTouches:[{identifier:1,clientX:box.x+25,clientY:box.y+42,target:area}],
  });
  await expect(page.getByRole("dialog",{name:"Contract"})).toBeVisible();
  await page.getByRole("button",{name:"Close focus mode"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth",390);
});
