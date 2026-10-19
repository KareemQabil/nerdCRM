import { expect, test } from "@playwright/test";
const moduleRoutes=["quotes","catalog","contracts","finance","projects","visits","quality","marketing","training","recruitment","certification","fundraising"];
test("all twelve fictional business workspaces open real page flows, not drawers",async ({page})=>{
  for(const area of moduleRoutes){
    const route=["training","recruitment","certification","fundraising"].includes(area)?"#/"+area:"#/demo/"+area;
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
  await expect(page).toHaveURL(/#\/demo\/contracts\/5101$/);
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
  await page.getByRole("button",{name:"محاكاة مرحلة الشهادة"}).click();
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
  await expect(page.locator(".demo-record-facts")).toContainText("32,500");
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
  await expect(page.locator(".demo-record-hero")).toContainText("Demo");
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
