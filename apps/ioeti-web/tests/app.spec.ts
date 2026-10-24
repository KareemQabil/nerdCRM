import { expect, test, type Page, type Route } from "@playwright/test";

const lines = [
  { id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 10, responsibleTeam: null },
  { id: 2, code: "TRAINING", nameAr: "التدريب", nameEn: "Training", status: 2, sequence: 20, responsibleTeam: null },
];

const leadStages = [
  { id: 1, name: "New", kind: "OPEN" }, { id: 2, name: "Qualified", kind: "OPEN" },
  { id: 5, name: "Converted", kind: "CONVERTED" }, { id: 6, name: "Lost", kind: "LOST" },
];

type MockRecord = { id: number; version: number; name: string; reference: string; businessLineCode: string; businessLineNameAr: string; businessLineNameEn: string; stage: string | null };

async function intercept(page: Page, config: { businessLineDenied?: boolean } = {}) {
  let records: MockRecord[] = [{
    id: 101, version: 1, name: "Hotel certification", reference: "OP-101",
    businessLineCode: "ISO9001", businessLineNameAr: "أيزو 9001", businessLineNameEn: "ISO 9001", stage: null,
  }];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path.endsWith("/session")) return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ code: "pilot.user", name: "Pilot user", language: "ar" }),
    });
    if (path.endsWith("/business-lines")) {
      if (config.businessLineDenied) return route.fulfill({ status: 403, body: "{}" });
      return result(lines);
    }
    if (path.endsWith("/leads") && method === "GET") {
      // the live lead list is searched on the server (Wave 6); the mock filters like the API does
      const q = (new URL(route.request().url()).searchParams.get("q") || "").toLowerCase();
      return result([
        { id: 207, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New" },
        { id: 206, name: "Mona Saber", organization: "Delta Foods", stage: "Qualified" },
      ].filter(lead => !q || `${lead.name} ${lead.organization}`.toLowerCase().includes(q)));
    }
    if (path.endsWith("/leads/stages") && method === "GET") return result(leadStages);
    if (path.endsWith("/leads/lost-reasons") && method === "GET") return result([{ id: 31, name: "Budget" }]);
    if (path.endsWith("/leads/207") && method === "GET") return result({ id: 207, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New" });
    if (path.endsWith("/accounts") && method === "GET") return result([
      { id: 901, name: "Nile View Hotel", reference: "AC-901", customer: false, prospect: true },
      { id: 902, name: "Delta Foods", reference: "AC-902", customer: true, prospect: false },
    ]);
    if (path.endsWith("/accounts/901") && method === "GET") return result({ id: 901, name: "Nile View Hotel", reference: "AC-901", customer: false, prospect: true });
    if (path.endsWith("/quotes") && method === "GET") return result([]);
    if (path.endsWith("/contracts") && method === "GET") return result([]);
    if (path.endsWith("/catalog/products") && method === "GET") return result([]);
    if (/\/opportunities\/\d+$/.test(path) && method === "GET") {
      const id = Number(path.split("/").at(-1));
      const record = records.find(item => item.id === id);
      return record ? result(record) : result(null,404);
    }
    if (path.endsWith("/opportunities") && method === "GET") return result(records);
    if (path.endsWith("/opportunities") && method === "POST") {
      const body = route.request().postDataJSON() as { name: string; businessLineCode: string };
      const line = lines.find(item => item.code === body.businessLineCode);
      const created = { id: 102, version: 1, name: body.name, reference: "OP-102", businessLineCode: body.businessLineCode,
        businessLineNameAr: line?.nameAr || "", businessLineNameEn: line?.nameEn || "", stage: null };
      records = [created, ...records];
      return result(created, 201);
    }
    if (path.includes("/opportunities/") && method === "PUT") {
      const id = Number(path.split("/").at(-1));
      const body = route.request().postDataJSON() as { name: string; version: number };
      const current = records.find(item => item.id === id);
      if (!current || current.version !== body.version) {
        return route.fulfill({ status: 409, body: "{}" });
      }
      const updated = { ...current, name: body.name, version: current.version + 1 };
      records = records.map(item => item.id === id ? updated : item);
      return result(updated);
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
}

test("Arabic theme switching preserves a real-API-shaped business line screen", async ({ page }) => {
  await intercept(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "نظام التصميم" }).click();
  await page.getByRole("button", { name: "فاخر" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await page.screenshot({ path: "test-results/ioeti-luxury-arabic-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "مضغوط" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.getByRole("button", { name: "مختصر" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-navigation", "rail");
  await page.getByRole("button", { name: "اللغة" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("opportunity create and rename use typed application endpoints", async ({ page }) => {
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  await page.getByRole("textbox", { name: "اسم الفرصة" }).fill("New customer opportunity");
  await page.getByLabel("خطوط الأعمال").selectOption("ISO9001");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("New customer opportunity")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "New customer opportunity" });
  await row.getByRole("button", { name: /تعديل اسم الفرصة/ }).click();
  await page.getByRole("textbox", { name: "اسم الفرصة" }).fill("New customer opportunity updated");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("New customer opportunity updated")).toBeVisible();
});

test("server validation errors are localized from the IOETI error contract, not shown raw", async ({ page }) => {
  await intercept(page);
  // registered after intercept(), so it takes precedence for this request
  await page.route("**/axelor-erp/ws/ioeti/opportunities", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
      codeStatus: 422, messageStatus: "Choose an active business line you can access.",
      error: { code: "VALIDATION_FAILED", message: "Choose an active business line you can access.",
        correlationId: "test-correlation-1", fields: [{ field: "businessLineCode", code: "UNAVAILABLE", message: "x" }] },
    }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  await page.getByRole("textbox", { name: "اسم الفرصة" }).fill("Opportunity on a closed line");
  await page.getByLabel("خطوط الأعمال").selectOption("TRAINING");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("خط الأعمال غير متاح لك أو غير نشط؛ اختر خطًا آخر")).toBeVisible();
  await expect(page.getByText("Choose an active business line you can access.")).toHaveCount(0);
});

test("unsafe requests send Axelor's CSRF token from its cookie; safe ones do not", async ({ page, context }) => {
  await context.addCookies([{ name: "CSRF-TOKEN", value: "csrf-token-123", domain: "127.0.0.1", path: "/" }]);
  await intercept(page);
  const seen: { method: string; token: string | null }[] = [];
  page.on("request", request => {
    if (request.url().includes("/ws/ioeti/opportunities")) {
      seen.push({ method: request.method(), token: request.headers()["x-csrf-token"] ?? null });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  await page.getByRole("textbox", { name: "اسم الفرصة" }).fill("CSRF protected create");
  await page.getByLabel("خطوط الأعمال").selectOption("ISO9001");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("CSRF protected create")).toBeVisible();
  expect(seen.filter(r => r.method === "POST").map(r => r.token)).toEqual(["csrf-token-123"]);
  expect(seen.filter(r => r.method === "GET").every(r => r.token === null)).toBe(true);
});

test("sign out ends the server session and returns to the sign-in screen", async ({ page }) => {
  await intercept(page);
  let loggedOut = false;
  await page.route("**/axelor-erp/logout", route => { loggedOut = true; return route.fulfill({ status: 204, body: "" }); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("button", { name: /دخول|تسجيل الدخول/ })).toBeVisible();
  expect(loggedOut).toBe(true);
});

test("throttled sign-in shows a localized wait message, not a generic failure", async ({ page }) => {
  await page.route("**/axelor-erp/ws/ioeti/session", route => route.fulfill({ status: 401, body: "" }));
  await page.route("**/axelor-erp/callback", route => route.fulfill({
    status: 429, contentType: "application/json", headers: { "Retry-After": "600" },
    body: JSON.stringify({ codeStatus: 429, messageStatus: "Too many requests; try again later.",
      error: { code: "RATE_LIMITED", message: "Too many requests; try again later.", correlationId: "c-1", fields: [] } }),
  }));
  await page.goto("/");
  await page.getByLabel(/اسم المستخدم|Username/).fill("sales.a");
  await page.getByLabel(/كلمة المرور|Password/).fill("wrong");
  await page.locator("form.login-form button[type=submit]").click();
  await expect(page.getByText("محاولات دخول كثيرة جدًا. انتظر بضع دقائق ثم حاول مرة أخرى.")).toBeVisible();
});

test("create form offers only lines the server allows; none assigned disables saving with an explanation", async ({ page }) => {
  await intercept(page);
  let creatable = [lines[1]];
  await page.route(/\/axelor-erp\/ws\/ioeti\/business-lines\?creatable=true$/, route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ codeStatus: 200, messageStatus: "ok", object: creatable }),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  const select = page.getByLabel("خطوط الأعمال");
  await expect(select.locator("option")).toHaveText(["اختر خط الأعمال", "التدريب"]);
  await page.getByRole("button", { name: "رجوع" }).first().click();
  creatable = [];
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  await expect(page.getByText("لم يتم تعيينك على أي خط أعمال بعد؛ اطلب من المسؤول إضافتك")).toBeVisible();
  await expect(page.getByRole("button", { name: "حفظ التغييرات" })).toBeDisabled();
});

test("lack of BusinessLine permissions is not treated as failed session login", async ({ page }) => {
  await intercept(page, { businessLineDenied: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
  await expect(page.getByText("حسابك لا يملك صلاحية قراءة خطوط الأعمال.")).toBeVisible();
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
});

test("mobile Arabic navigation reaches live opportunity route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await intercept(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "التنقل" }).click();
  await page.getByRole("button", { name: "الفرص التجارية", exact: true }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
  await page.screenshot({ path: "test-results/ioeti-arabic-mobile-opportunities.png", fullPage: true });
});

test("reverse-mapped Leads list and secured detail route use specific DTO APIs",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"العملاء المحتملون"}).click();
  await expect(page.getByText("Nour Hassan")).toBeVisible();
  const searched=page.waitForRequest(request=>request.url().includes("/ws/ioeti/marketing/leads?")&&new URL(request.url()).searchParams.get("q")==="Delta");
  await page.getByPlaceholder("ابحث بالاسم أو الجهة أو البريد أو الهاتف...").fill("Delta");
  await searched;
  await expect(page.getByText("Mona Saber")).toBeVisible();
  await expect(page.getByText("Nour Hassan")).toHaveCount(0);
  await page.getByPlaceholder("ابحث بالاسم أو الجهة أو البريد أو الهاتف...").fill("");
  const row=page.locator(".directory-item").filter({hasText:"Nour Hassan"});
  await row.getByRole("button",{name:"عرض التفاصيل"}).click();
  await expect(page.locator(".record-workspace")).toContainText("Nile View Hotel");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/leads\/207$/);
  await page.getByRole("button",{name:"الرجوع إلى العملاء المحتملين"}).click();
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(page.getByText("Nour Hassan")).toBeVisible();
});

test("Account directory excludes unnecessary private data and uses authorized route",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"حسابات العملاء"}).click();
  await expect(page.getByText("Nile View Hotel")).toBeVisible();
  await expect(page.getByText("Delta Foods")).toBeVisible();
  const row=page.locator(".directory-item").filter({hasText:"Nile View Hotel"});
  await row.getByRole("button",{name:"عرض التفاصيل"}).click();
  await expect(page.locator(".record-workspace")).toContainText("AC-901");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/accounts\/901$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/accounts$/);
  await expect(page.getByText("Nile View Hotel")).toBeVisible();
});

test("account details use full-page context, preserve filtered list and direct URL", async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"حسابات العملاء"}).click();
  const search=page.getByPlaceholder("ابحث في السجلات المحمّلة...");
  await search.fill("Nile");
  await page.locator(".directory-item").filter({hasText:"Nile View Hotel"})
    .getByRole("button",{name:"عرض التفاصيل"}).click();
  await expect(page).toHaveURL(/#\/accounts\/901$/);
  await expect(page.locator(".record-workspace h1")).toHaveText("Nile View Hotel");
  await expect(page.locator(".side-panel")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".record-workspace h1")).toHaveText("Nile View Hotel");
  await page.getByRole("button",{name:"الرجوع إلى حسابات العملاء"}).click();
  await expect(page.getByRole("heading",{name:"دليل حسابات العملاء"})).toBeVisible();
});

test("record page on mobile is never rendered as side drawer", async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"التنقل"}).click();
  await page.getByRole("button",{name:"حسابات العملاء"}).click();
  await page.locator(".directory-item").filter({hasText:"Nile View Hotel"})
    .getByRole("button",{name:"عرض التفاصيل"}).click();
  await expect(page.locator(".record-workspace")).toBeVisible();
  await expect(page.locator(".record-drawer")).toHaveCount(0);
  await page.screenshot({path:"test-results/ioeti-account-record-page-mobile.png",fullPage:true});
});

test("Opportunity view details opens a full record page, supports browser history and safe context",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"الفرص التجارية",exact:true}).click();
  const row=page.getByRole("row").filter({hasText:"Hotel certification"});
  await row.getByRole("button",{name:"التفاصيل"}).click();
  await expect(page).toHaveURL(/#\/opportunities\/101$/);
  await expect(page.locator(".opportunity-record h1")).toHaveText("Hotel certification");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".opportunity-record")).toContainText("OP-101");
  await expect(page.locator(".opportunity-record")).toContainText("المبيعات · الفرص التجارية");
  // quotations and the contract are connected sections; live mode shows no placeholder for anything unconnected
  await expect(page.getByRole("heading", { name: "عروض الأسعار" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "العقد", exact: true })).toBeVisible();
  await expect(page.locator(".opportunity-record")).not.toContainText("Event API");
  await page.goBack();
  await expect(page).toHaveURL(/#\/opportunities$/);
  await expect(page.getByRole("row").filter({hasText:"Hotel certification"})).toBeVisible();
});

test("Opportunity direct deep link refetches the authorized record and rename stays a small modal",async ({page})=>{
  await intercept(page);
  await page.goto("/#/opportunities/101");
  await expect(page.locator(".opportunity-record h1")).toHaveText("Hotel certification");
  await page.locator(".opportunity-record").getByRole("button",{name:"تعديل اسم الفرصة"}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox",{name:"اسم الفرصة"}).fill("Hotel certification v2");
  await page.getByRole("button",{name:"حفظ التغييرات"}).click();
  await expect(page.locator(".opportunity-record h1")).toHaveText("Hotel certification v2");
  await expect(page.locator(".opportunity-record")).toContainText("v2");
  await page.getByRole("button",{name:"الرجوع إلى الفرص"}).click();
  await expect(page).toHaveURL(/#\/opportunities$/);
});

test("Opportunity record workspace remains a full page on mobile",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await intercept(page);
  await page.goto("/#/opportunities/101");
  await expect(page.locator(".opportunity-record")).toBeVisible();
  await expect(page.locator(".record-drawer")).toHaveCount(0);
  await page.screenshot({path:"test-results/ioeti-opportunity-record-mobile.png",fullPage:true});
});

test("live mode shows the system map: real status per domain, decisions that hold a part, and the person's access",async ({page})=>{
  await intercept(page);
  const probed:string[]=[];
  // later routes win: these answer the map's access checks
  await page.route(/\/axelor-erp\/ws\/ioeti\/(certification\/cycles|training\/courses|fundraising\/donors|recruitment\/job-orders|operations\/handovers|marketing\/campaigns|catalog\/products|visits)/,route=>{
    const path=new URL(route.request().url()).pathname;
    probed.push(path);
    if(path.endsWith("/fundraising/donors"))return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({codeStatus:403,error:{code:"FORBIDDEN",fields:[]}})});
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({codeStatus:200,object:[]})});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await expect(page.getByRole("heading",{name:"خريطة النظام",level:1})).toBeVisible();
  await expect(page.locator(".system-map-card")).toHaveCount(15);
  const visits=page.locator(".system-map-card").filter({hasText:"الزيارات الميدانية"});
  await expect(visits.locator(".system-map-status")).toHaveText("شغال");
  await expect(visits.locator(".system-map-decision")).toHaveText("D-10");
  await expect(visits.getByRole("link",{name:/افتح/})).toHaveAttribute("href","#/visits");
  await expect(page.locator(".system-map-card").filter({hasText:"الجودة والإجراءات التصحيحية"}).locator(".system-map-status")).toHaveText("شغال جزئيًا");
  const cert=page.locator(".system-map-card").filter({hasText:"إدارة شهادات ISO"});
  await expect(cert).toContainText("شغال");
  await expect(cert.locator(".system-map-decision")).toHaveText("D-02");
  await expect(cert).toContainText("متاح لك");
  await expect(cert.getByRole("link",{name:/افتح/})).toHaveAttribute("href","#/certification");
  const fund=page.locator(".system-map-card").filter({hasText:"تنمية الموارد"});
  await expect(fund).toContainText("مش ضمن صلاحياتك");
  await expect(fund.getByRole("link")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("غير موصل");
  await expect(page.getByRole("region",{name:"رحلة العمل المقترحة"})).toHaveCount(0);
  expect(probed.some(p=>p.endsWith("/certification/cycles"))).toBe(true);
  await page.locator(".system-map").getByRole("textbox").fill("certification");
  await expect(page.locator(".system-map-card")).toHaveCount(1);
});

test("the live system map works on a phone and in English, and opens the real screen",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await intercept(page);
  await page.goto("/#/capabilities");
  await page.getByRole("button",{name:"اللغة"}).click();
  await expect(page.getByRole("heading",{name:"System map",level:1})).toBeVisible();
  const leads=page.locator(".system-map-card").filter({hasText:"Leads"}).first();
  await expect(leads).toContainText("Works now");
  await expect(leads.locator(".system-map-decision")).toHaveText("D-12");
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await leads.getByRole("link",{name:/Open/}).click();
  await expect(page).toHaveURL(/#\/leads$/);
});

test("Opportunity compact modal traps focus, escapes safely and restores originating button focus",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"الفرص التجارية",exact:true}).click();
  const create=page.getByRole("button",{name:"فرصة جديدة"});
  await create.focus();
  await create.click();
  const dialog=page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox",{name:"اسم الفرصة"})).toBeFocused();
  await dialog.getByRole("button",{name:"حفظ التغييرات"}).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button",{name:"رجوع"}).first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button",{name:"حفظ التغييرات"})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});

test("real authenticated mode never mounts fictional operating workspaces",async ({page})=>{
  await intercept(page);
  await page.goto("/#/demo/quotes");
  await expect(page.locator(".demo-business")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:/^مرحبًا/})).toBeVisible();
  // Settings is the real settings page in live mode (Wave 7b), never the fictional admin workspace
  await page.locator("button.nav-item").filter({hasText:"الإعدادات"}).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole("heading",{name:"الإعدادات",level:1})).toBeVisible();
  await expect(page.locator(".demo-business")).toHaveCount(0);
});

test("real mode never downloads multi-domain demo workspace chunks or fixtures",async ({page})=>{
  const fetched:string[]=[];
  page.on("request",request=>fetched.push(request.url()));
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await page.locator("button.nav-item").filter({hasText:"الإعدادات"}).click();
  await expect(page.getByRole("heading",{name:"الإعدادات",level:1})).toBeVisible();
  expect(fetched.filter(url=>/DemoBusinessWorkspace|DemoExecutiveOverview|DemoDomainWorkbench|demoBusiness\.(ts|js)/.test(url))).toEqual([]);
});

async function conversionMocks(page: Page, convert: (body: Record<string, unknown>) => { status: number; body: unknown }) {
  await intercept(page);
  let lead = { id: 207, version: 3, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", converted: false,
    businessLineCode: "TRAINING", accountId: null as number | null, opportunityId: null as number | null };
  const requests: Record<string, unknown>[] = [];
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  await page.route(/\/axelor-erp\/ws\/ioeti\/business-lines\?creatable=true$/, route => route.fulfill(ok(lines)));
  await page.route(/\/axelor-erp\/ws\/ioeti\/leads\/207$/, route => route.fulfill(ok(lead)));
  await page.route(/\/axelor-erp\/ws\/ioeti\/leads\/207\/convert$/, route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ ...body, csrf: route.request().headers()["x-csrf-token"] ?? null });
    const answer = convert(body);
    if (answer.status === 201) lead = { ...lead, version: 4, converted: true, stage: "Converted", accountId: 901, opportunityId: 140 };
    return route.fulfill(answer.status === 201 ? ok(answer.body, 201)
      : { status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\/901\/opportunities$/, route => route.fulfill(ok([
    { id: 140, version: 0, name: "Nile View Hotel", reference: "OP-140", businessLineCode: "TRAINING",
      businessLineNameAr: "التدريب", businessLineNameEn: "Training", stage: "New" }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\/901\/contacts$/, route => route.fulfill(ok([
    { id: 950, name: "Nour Hassan", jobTitle: null }])));
  return requests;
}
const contractError = (status: number, code: string, field?: string) => ({ status, body: {
  codeStatus: status, messageStatus: "x", error: { code, message: "x", correlationId: "c0ffee00", fields: field ? [{ field, code: "UNAVAILABLE", message: "x" }] : [] } } });

test("lead conversion: full-page wizard converts once, then links the account and its Account 360", async ({page}) => {
  await page.context().addCookies([{ name: "CSRF-TOKEN", value: "csrf-207", url: "http://127.0.0.1:5173" }]);
  const requests = await conversionMocks(page, () => ({ status: 201, body: { leadId: 207, accountId: 901, contactId: 950, opportunityId: 140 } }));
  await page.goto("/#/leads/207");
  await page.getByRole("link", { name: "تحويل إلى حساب وفرصة" }).click();
  await expect(page).toHaveURL(/#\/leads\/207\/convert$/);
  await expect(page.getByRole("heading", { name: "تحويل العميل المحتمل" })).toBeVisible();
  await expect(page.getByLabel("اسم الفرصة التجارية")).toHaveValue("Nile View Hotel");
  await expect(page.getByLabel("خط الأعمال")).toHaveValue("TRAINING");
  await page.getByRole("button", { name: "تحويل", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تم التحويل" })).toBeVisible();
  expect(requests).toEqual([{ version: 3, opportunityName: "Nile View Hotel", businessLineCode: "TRAINING", csrf: "csrf-207" }]);
  await page.screenshot({ path: "test-results/ioeti-lead-converted.png", fullPage: true });
  await page.getByRole("link", { name: "فتح الحساب" }).click();
  await expect(page).toHaveURL(/#\/accounts\/901$/);
  await expect(page.locator(".record-workspace h1")).toHaveText("Nile View Hotel");
  await expect(page.getByRole("tab", { name: /الفرص التجارية \(1\)/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("OP-140");
  await page.getByRole("tab", { name: /جهات الاتصال/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Nour Hassan");
  await page.goto("/#/leads/207");
  await expect(page.getByRole("link", { name: "تحويل إلى حساب وفرصة" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "فتح الفرصة" })).toHaveAttribute("href", "#/opportunities/140");
});

test("lead conversion: server refusals are localized, never shown raw, and nothing is claimed", async ({page}) => {
  const answers = [contractError(422, "VALIDATION_FAILED", "accountId"), contractError(422, "CONVERSION_REJECTED"),
    contractError(409, "CONFLICT"), contractError(409, "ALREADY_CONVERTED")];
  const requests = await conversionMocks(page, () => answers.shift()!);
  await page.goto("/#/leads/207/convert");
  await page.getByLabel("إضافة إلى حساب موجود").check();
  await page.getByLabel("اختر الحساب").selectOption("902");
  const convert = page.getByRole("button", { name: "تحويل", exact: true });
  await convert.click();
  await expect(page.getByRole("alert")).toHaveText(/لا يمكنك إضافة الفرصة إلى هذا الحساب/);
  expect(requests[0]).toMatchObject({ accountId: 902 });
  await convert.click();
  await expect(page.getByRole("alert")).toHaveText(/لا يمكن تحويل هذا العميل المحتمل في حالته الحالية/);
  await convert.click();
  await expect(page.getByRole("alert")).toHaveText(/عدّل شخص آخر هذا السجل/);
  await convert.click();
  await expect(page.getByRole("alert")).toHaveText(/تم تحويل هذا العميل المحتمل من قبل/);
  await expect(page.getByRole("heading", { name: "تم التحويل" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("c0ffee00");
});

const emptyPlan = (quoteVersion: number) => ({ quoteId: 7, quoteVersion, currency: "EGP", totalBeforeTax: "3000.00",
  plannedPercentage: "0", plannedAmountBeforeTax: "0", bookingStatus: "NOT_BOOKED", bookedBeforeTax: "0", invoiced: "0",
  collected: "0", invoicingStatus: "BLOCKED_BY_POLICY", milestones: [] as unknown[] });

test("quotations: opportunity page creates a draft from the catalog, before tax only, finalize blocked by policy", async ({page}) => {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  let quote = { id: 7, version: 0, reference: "#7", status: "DRAFT", opportunityId: 101, accountId: 901, accountName: "Nile View Hotel",
    currency: "EGP", totalBeforeTax: "0", taxStatus: "BLOCKED_BY_POLICY", lines: [] as unknown[] };
  const posts: { path: string; body: unknown }[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/catalog\/products/, route => route.fulfill(ok([
    { id: 31, code: "ISO-AUD-DAY", name: "Audit day", unit: "Day", salePrice: "1500.0000", currency: "EGP" }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes(\/.*|\?.*)?$/, route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") return route.fulfill(ok([]));
    posts.push({ path: url.pathname, body: route.request().postDataJSON() });
    if (url.pathname.endsWith("/quotes")) return route.fulfill(ok(quote, 201));
    quote = { ...quote, version: 1, totalBeforeTax: "3000.00", lines: [{ id: 1, productCode: "ISO-AUD-DAY", name: "Audit day",
      quantity: "2.0000000000", unit: "Day", unitPriceBeforeTax: "1500.00", totalBeforeTax: "3000.00" }] };
    return route.fulfill(ok(quote, 201));
  });
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes\/\d+\/milestones/, route => route.fulfill(ok(emptyPlan(quote.version))));
  await page.goto("/#/opportunities/101");
  await expect(page.getByRole("heading", { name: "عروض الأسعار" })).toBeVisible();
  await page.getByRole("button", { name: "عرض سعر جديد" }).click();
  await expect(page.locator(".quote-head")).toContainText("#7");
  await page.getByLabel("المنتج أو الخدمة").selectOption("31");
  await page.getByLabel("الكمية").fill("2");
  await page.getByRole("button", { name: "إضافة بند" }).click();
  await expect(page.locator(".quote-lines tfoot")).toContainText("3000.00 EGP");
  expect(posts).toEqual([
    { path: "/axelor-erp/ws/ioeti/quotes", body: { opportunityId: 101, opportunityVersion: 1 } },
    { path: "/axelor-erp/ws/ioeti/quotes/7/lines", body: { version: 0, productId: 31, quantity: 2 } },
  ]);
  await expect(page.getByText("لا تُحسب الضرائب هنا حتى تعتمد IOETI سياسة الضرائب والفوترة (D-06).")).toBeVisible();
  await expect(page.getByRole("button", { name: "اعتماد وإرسال العرض" })).toBeDisabled();
  await page.screenshot({ path: "test-results/ioeti-quote-draft.png", fullPage: true });
});

test("quotations: setup and account refusals are localized, never raw", async ({page}) => {
  await intercept(page);
  const answers = [
    { status: 422, error: { code: "VALIDATION_FAILED", message: "x", correlationId: "deadbeef1", fields: [{ field: "opportunityId", code: "ACCOUNT_REQUIRED", message: "x" }] } },
    { status: 422, error: { code: "SETUP_REQUIRED", message: "Sales setup internal", correlationId: "deadbeef2", fields: [] } },
  ];
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes$/, route => {
    const next = answers.shift()!;
    return route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify({ codeStatus: next.status, messageStatus: "x", error: next.error }) });
  });
  await page.goto("/#/opportunities/101");
  const create = page.getByRole("button", { name: "عرض سعر جديد" });
  await create.click();
  await expect(page.getByRole("alert")).toHaveText(/اربط الفرصة بحساب عميل أولًا/);
  await create.click();
  await expect(page.getByRole("alert")).toHaveText(/إعداد المبيعات لهذه الشركة أو لهذا المنتج غير مكتمل/);
  await expect(page.locator("body")).not.toContainText("deadbeef");
  await expect(page.locator("body")).not.toContainText("Sales setup internal");
});

test("payment milestones: added with the quotation version; booked, invoiced and collected stay separate; refusals localized", async ({page}) => {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const quote = { id: 7, version: 3, reference: "#7", status: "DRAFT", opportunityId: 101, accountId: 901, accountName: "Nile View Hotel",
    currency: "EGP", totalBeforeTax: "3000.00", taxStatus: "BLOCKED_BY_POLICY", lines: [] };
  let plan = { ...emptyPlan(3) };
  const posts: unknown[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes\?opportunityId=101$/, route => route.fulfill(ok([quote])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes\/7\/milestones$/, route => {
    if (route.request().method() === "GET") return route.fulfill(ok(plan));
    const body = route.request().postDataJSON() as { percentage: number };
    posts.push(body);
    if (Number(plan.plannedPercentage) + body.percentage > 100) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ codeStatus: 422, messageStatus: "x",
      error: { code: "VALIDATION_FAILED", message: "x", correlationId: "feedface1", fields: [{ field: "percentage", code: "TOTAL_EXCEEDED", message: "x" }] } }) });
    plan = { ...plan, quoteVersion: 4, plannedPercentage: "30", plannedAmountBeforeTax: "900.00",
      milestones: [{ id: 51, title: "Contract signature", percentage: "30.00", amountBeforeTax: "900.00", dueDate: "2027-01-31", state: "PLANNED", invoiceReference: null }] };
    return route.fulfill(ok(plan, 201));
  });
  await page.goto("/#/opportunities/101");
  await expect(page.getByRole("heading", { name: "دفعات السداد" })).toBeVisible();
  await expect(page.locator(".milestone-figures")).toContainText("غير محجوز بعد");
  await page.getByLabel("اسم الدفعة").fill("Contract signature");
  await page.getByLabel("النسبة %").fill("30");
  await page.getByLabel("تاريخ الاستحقاق").fill("2027-01-31");
  await page.getByRole("button", { name: "إضافة دفعة" }).click();
  await expect(page.locator(".milestones table")).toContainText("Contract signature");
  await expect(page.locator(".milestones table")).toContainText("مخططة");
  expect(posts[0]).toEqual({ version: 3, title: "Contract signature", percentage: 30, dueDate: "2027-01-31" });
  await page.getByLabel("اسم الدفعة").fill("Too much");
  await page.getByLabel("النسبة %").fill("80");
  await page.getByLabel("تاريخ الاستحقاق").fill("2027-02-28");
  await page.getByRole("button", { name: "إضافة دفعة" }).click();
  await expect(page.getByRole("alert")).toHaveText(/مجموع نسب الدفعات لا يمكن أن يتجاوز 100%/);
  expect(posts[1]).toMatchObject({ version: 4 });
  await expect(page.locator("body")).not.toContainText("feedface");
  await expect(page.getByText("إصدار الفواتير من الدفعات متوقف حتى اعتماد سياسة المالية (D-06).")).toBeVisible();
  await page.screenshot({ path: "test-results/ioeti-quote-milestones.png", fullPage: true });
});

test("contract: draft created natively with the chosen type and opportunity version; signature and handover stay blocked", async ({page}) => {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const posts: unknown[] = [];
  let answers: { status: number; body: unknown }[] = [
    { status: 422, body: { codeStatus: 422, messageStatus: "x", error: { code: "SETUP_REQUIRED", message: "x", correlationId: "cafe0001", fields: [] } } },
  ];
  await page.route(/\/axelor-erp\/ws\/ioeti\/contracts$/, route => {
    posts.push(route.request().postDataJSON());
    const next = answers.shift();
    if (next) return route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify(next.body) });
    return route.fulfill(ok({ id: 3, version: 1, reference: "CT0003", name: "Hotel certification", status: "DRAFT", contractType: "FRAMEWORK",
      opportunityId: 101, accountId: 901, accountName: "Nile View Hotel", currency: "EGP", activationStatus: "BLOCKED_BY_POLICY" }, 201));
  });
  await page.goto("/#/opportunities/101");
  await expect(page.getByRole("heading", { name: "العقد", exact: true })).toBeVisible();
  await page.getByLabel("نوع العقد").selectOption("FRAMEWORK");
  await page.getByRole("button", { name: "إنشاء مسودة عقد" }).click();
  await expect(page.getByRole("alert")).toHaveText(/إعداد العقود لهذه الشركة غير مكتمل/);
  await expect(page.locator("body")).not.toContainText("cafe0001");
  await page.getByRole("button", { name: "إنشاء مسودة عقد" }).click();
  await expect(page.locator(".contract-body")).toContainText("CT0003");
  await expect(page.locator(".contract-body")).toContainText("عقد إطاري");
  expect(posts).toEqual([
    { opportunityId: 101, opportunityVersion: 1, contractType: "FRAMEWORK" },
    { opportunityId: 101, opportunityVersion: 1, contractType: "FRAMEWORK" },
  ]);
  await expect(page.getByRole("button", { name: "توقيع وتفعيل العقد" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "التسليم لفريق التنفيذ" })).toBeDisabled();
  await expect(page.getByText("التوقيع والتفعيل والتسليم للتنفيذ متوقفة حتى اعتماد سياسة الموافقات والاعتماد القانوني (D-11).")).toBeVisible();
});

test("contract: lines are copied once from the quotation with the contract version; total before tax and lineage shown", async ({page}) => {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const draft = { id: 3, version: 2, reference: "CT0003", name: "Hotel certification", status: "DRAFT", contractType: "BILLING",
    opportunityId: 101, accountId: 901, accountName: "Nile View Hotel", currency: "EGP", activationStatus: "BLOCKED_BY_POLICY",
    sourceQuoteId: null, lines: [], totalBeforeTax: "0" };
  const quote = { id: 7, version: 4, reference: "#7", status: "DRAFT", opportunityId: 101, accountId: 901, accountName: "Nile View Hotel",
    currency: "EGP", totalBeforeTax: "3000.00", taxStatus: "BLOCKED_BY_POLICY",
    lines: [{ id: 1, productCode: "ISO-AUD-DAY", name: "Audit day", quantity: "2", unit: "Day", unitPriceBeforeTax: "1500.00", totalBeforeTax: "3000.00" }] };
  const posts: unknown[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/contracts\?opportunityId=101$/, route => route.fulfill(ok([draft])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes\?opportunityId=101$/, route => route.fulfill(ok([quote])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/quotes\/7\/milestones$/, route => route.fulfill(ok(emptyPlan(4))));
  await page.route(/\/axelor-erp\/ws\/ioeti\/contracts\/3\/lines-from-quote$/, route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill(ok({ ...draft, version: 3, sourceQuoteId: 7, totalBeforeTax: "3000.00",
      lines: [{ id: 11, productCode: "ISO-AUD-DAY", name: "Audit day", quantity: "2.0000000000", unitPriceBeforeTax: "1500.00", totalBeforeTax: "3000.00" }] }, 201));
  });
  await page.goto("/#/opportunities/101");
  await page.getByRole("button", { name: "نسخ البنود من عرض السعر" }).click();
  await expect(page.locator(".contract-body table")).toContainText("Audit day");
  await expect(page.locator(".contract-body tfoot")).toContainText("3000.00 EGP");
  await expect(page.locator(".contract-body tfoot")).toContainText("منسوخة من عرض السعر #7");
  expect(posts).toEqual([{ version: 2, quoteId: 7 }]);
  await expect(page.getByRole("button", { name: "نسخ البنود من عرض السعر" })).toHaveCount(0);
});

test("lead qualification: stage, lose, reopen and assign-to-me send the lead version; refusals localized", async ({page}) => {
  await intercept(page);
  let lead = { id: 207, version: 3, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", stageId: 1, stageKind: "OPEN",
    converted: false, businessLineCode: "ISO9001", accountId: null, opportunityId: null, lostReason: null as string | null,
    assignedToMe: false, receivedAt: "2026-10-18T09:30:00" };
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  const answers: Record<string, unknown>[] = [];
  const ok = (object: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ codeStatus: 200, messageStatus: "ok", object }) });
  await page.route(/\/axelor-erp\/ws\/ioeti\/leads\/207$/, route => route.fulfill(ok(lead)));
  await page.route(/\/axelor-erp\/ws\/ioeti\/leads\/207\/(stage|lose|reopen|assign)$/, route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ action, body });
    const refusal = answers.shift();
    if (refusal) return route.fulfill({ status: refusal.status as number, contentType: "application/json", body: JSON.stringify(refusal.body) });
    if (action === "stage") lead = { ...lead, stageId: 2, stage: "Qualified" };
    if (action === "lose") lead = { ...lead, stageId: 6, stage: "Lost", stageKind: "LOST", lostReason: "Budget" };
    if (action === "reopen") lead = { ...lead, stageId: 1, stage: "New", stageKind: "OPEN", lostReason: null };
    if (action === "assign") lead = { ...lead, assignedToMe: true };
    lead = { ...lead, version: lead.version + 1 };
    return route.fulfill(ok(lead));
  });
  await page.goto("/#/leads/207");
  await expect(page.getByText("غير مكلّف بك")).toBeVisible();
  await expect(page.getByText(/D-12/)).toBeVisible();
  const move = page.getByLabel("نقل للمرحلة");
  await expect(move.locator("option")).toHaveText(["—", "Qualified"]);
  await move.selectOption("2");
  await page.getByRole("button", { name: "نقل للمرحلة" }).click();
  await expect(page.locator(".record-status-tag").first()).toContainText("Qualified");
  await page.getByRole("button", { name: "تكليف لي" }).click();
  await expect(page.getByText("مكلّف بك", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تكليف لي" })).toHaveCount(0);
  await page.getByRole("button", { name: "تسجيل كخسارة" }).click();
  await page.getByLabel("سبب الخسارة").selectOption("31");
  await page.getByLabel("ملاحظة داخلية (اختياري)").fill("Budget frozen");
  await page.getByRole("button", { name: "تأكيد الخسارة" }).click();
  await expect(page.getByText("Budget", { exact: true })).toBeVisible();
  await expect(page.getByLabel("نقل للمرحلة")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "تحويل إلى حساب وفرصة" })).toHaveCount(0);
  await expect(page.getByText("عميل محتمل خاسر · أعد فتحه للتحويل")).toBeVisible();
  await page.screenshot({ path: "test-results/ioeti-lead-lost.png", fullPage: true });
  await page.getByRole("button", { name: "إعادة فتح العميل المحتمل" }).click();
  await expect(page.getByLabel("نقل للمرحلة")).toBeVisible();
  await expect(page.getByRole("link", { name: "تحويل إلى حساب وفرصة" })).toBeVisible();
  expect(requests).toEqual([
    { action: "stage", body: { version: 3, stageId: 2 } },
    { action: "assign", body: { version: 4 } },
    { action: "lose", body: { version: 5, lostReasonId: 31, note: "Budget frozen" } },
    { action: "reopen", body: { version: 6 } },
  ]);
  answers.push(contractError(409, "CONFLICT"), contractError(422, "LEAD_REJECTED"));
  await page.getByLabel("نقل للمرحلة").selectOption("2");
  await page.getByRole("button", { name: "نقل للمرحلة" }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل السجل من مكان آخر/);
  await page.getByRole("button", { name: "نقل للمرحلة" }).click();
  await expect(page.getByRole("alert")).toHaveText(/لا يمكن تنفيذ هذا الإجراء على العميل المحتمل/);
  await expect(page.locator("body")).not.toContainText("c0ffee00");
});

test("training: open a cohort, enrol into seats then the waitlist, cancel promotes, attendance; D-03 actions stay disabled", async ({page}) => {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const course = { id: 3, version: 0, code: "ISO-IA", name: "Internal auditor ISO 9001", nameAr: null, durationHours: 16, active: true };
  let cohort = { id: 40, version: 1, code: "IA-NOV", courseId: 3, courseName: course.name, startDate: "2026-11-01", endDate: "2026-11-02",
    capacity: 1, minSeats: null, location: "Cairo", status: "PLANNED", confirmed: 0, waitlisted: 0, seatsLeft: 1, coordinatedByMe: true };
  type Row = { id: number; version: number; traineeId: number; traineeName: string; clientName: string | null; status: string; waitlistPosition: number | null };
  let enrollments: Row[] = [];
  const session = { id: 70, version: 0, title: "Day 1", startsAt: "2026-11-01T09:00:00", durationMinutes: 240 };
  const attendance: { id: number; enrollmentId: number; status: string }[] = [];
  const requests: { path: string; body: unknown }[] = [];
  const recount = () => {
    const confirmed = enrollments.filter(e => e.status === "CONFIRMED").length;
    cohort = { ...cohort, version: cohort.version + 1, confirmed, waitlisted: enrollments.filter(e => e.status === "WAITLISTED").length, seatsLeft: cohort.capacity - confirmed };
  };
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\?/, route => route.fulfill(ok([{ id: 902, name: "Delta Foods", reference: "AC-902", customer: true, prospect: false }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\/902\/contacts$/, route => route.fulfill(ok([
    { id: 951, name: "Sara Adel", jobTitle: "QA lead" }, { id: 952, name: "Omar Nabil", jobTitle: null }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/training\//, route => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/ws\/ioeti\/training/, "");
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() as Record<string, unknown> : null;
    if (body) requests.push({ path, body });
    if (path === "/courses") return route.fulfill(ok([course]));
    if (path === "/cohorts") return route.fulfill(ok([cohort]));
    if (path === "/cohorts/40" ) return route.fulfill(ok(cohort));
    if (path === "/cohorts/40/open") { cohort = { ...cohort, status: "OPEN", version: cohort.version + 1 }; return route.fulfill(ok(cohort)); }
    if (path === "/cohorts/40/enrollments" && method === "GET") return route.fulfill(ok(enrollments));
    if (path === "/cohorts/40/enrollments") {
      const full = enrollments.filter(e => e.status === "CONFIRMED").length >= cohort.capacity;
      const row = { id: 500 + enrollments.length, version: 0, traineeId: body!.traineeId as number,
        traineeName: body!.traineeId === 951 ? "Sara Adel" : "Omar Nabil", clientName: "Delta Foods",
        status: full ? "WAITLISTED" : "CONFIRMED", waitlistPosition: full ? 1 : null };
      enrollments = [...enrollments, row]; recount(); return route.fulfill(ok(row, 201));
    }
    if (/\/enrollments\/\d+\/cancel$/.test(path)) {
      const id = Number(path.split("/")[2]);
      enrollments = enrollments.map(e => e.id === id ? { ...e, status: "CANCELLED", waitlistPosition: null }
        : e.status === "WAITLISTED" ? { ...e, status: "CONFIRMED", waitlistPosition: null } : e);
      recount(); return route.fulfill(ok(enrollments.find(e => e.id === id)));
    }
    if (path === "/cohorts/40/sessions" && method === "GET") return route.fulfill(ok([session]));
    if (path === "/sessions/70/attendance" && method === "GET") return route.fulfill(ok(attendance));
    if (path === "/sessions/70/attendance") {
      attendance.splice(0, attendance.length, { id: 1, enrollmentId: body!.enrollmentId as number, status: body!.status as string });
      session.version += 1; return route.fulfill(ok(attendance[0]));
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("/#/training");
  await expect(page.getByRole("heading", { name: "التدريب الخارجي" })).toBeVisible();
  await page.getByRole("button", { name: /Internal auditor ISO 9001/ }).click();
  await expect(page.getByRole("button", { name: "إلغاء الدفعة" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "إصدار شهادة" })).toBeDisabled();
  await expect(page.getByText(/D-03/)).toBeVisible();
  await page.getByRole("button", { name: "فتح التسجيل" }).click();
  await page.getByLabel("الجهة الراعية").selectOption("902");
  const traineeSelect = page.getByRole("combobox", { name: "المتدرب", exact: true });
  await expect(traineeSelect.locator("option")).toHaveCount(3);
  await traineeSelect.selectOption("951");
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Sara Adel" })).toBeVisible();
  await traineeSelect.selectOption("952");
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await expect(page.getByText("قائمة الانتظار #1")).toBeVisible();
  await page.getByRole("row", { name: /Sara Adel/ }).getByRole("button", { name: "إلغاء التسجيل" }).click();
  await expect(page.getByText("قائمة الانتظار #1")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Omar Nabil/ })).toContainText("مؤكد");
  await page.getByRole("button", { name: /Day 1/ }).click();
  await page.getByRole("group", { name: /Omar Nabil/ }).getByRole("button", { name: "حاضر" }).click();
  await expect(page.getByRole("group", { name: /Omar Nabil/ }).getByRole("button", { name: "حاضر" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/ioeti-training.png", fullPage: true });
  expect(requests.map(r => r.path)).toEqual(["/cohorts/40/open", "/cohorts/40/enrollments", "/cohorts/40/enrollments",
    "/enrollments/500/cancel", "/sessions/70/attendance"]);
  expect(requests[1].body).toMatchObject({ traineeId: 951, clientId: 902 });
  expect(requests[4].body).toEqual({ version: 0, enrollmentId: 501, status: "PRESENT" });
});

async function certificationMocks(page: Page, options: { managedByMe?: boolean; failList?: number } = {}) {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, field?: string, fieldCode = "UNAVAILABLE") => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee01", fields: field ? [{ field, code: fieldCode, message: "x" }] : [] } }) });
  let failures = options.failList ?? 0;
  const base = { id: 61, reference: "CYC-NILE", clientId: 901, clientName: "Nile Foods", standardCode: "ISO9001", scope: "Packaged foods",
    siteCount: 2, decisionStatus: "BLOCKED_BY_POLICY", managedByMe: options.managedByMe ?? true, managerName: "Mona" };
  const state = { version: 3, audits: [] as Record<string, unknown>[], ncs: [] as Record<string, unknown>[] };
  const cycle = () => {
    const done = (t: string) => state.audits.some(a => a.type === t && a.status === "COMPLETED");
    const majors = state.ncs.filter(n => n.grade === "MAJOR" && n.status !== "CLOSED").length;
    const blockers = [...(done("STAGE1") ? [] : ["STAGE1_NOT_COMPLETED"]), ...(done("STAGE2") ? [] : ["STAGE2_NOT_COMPLETED"]),
      ...(majors ? ["OPEN_MAJOR_NONCONFORMITIES"] : []), "POLICY_D02"];
    const phase = !done("STAGE1") ? "STAGE1_PENDING" : !done("STAGE2") ? "STAGE2_PENDING" : majors ? "FINDINGS_OPEN" : "READY_FOR_DECISION";
    return { ...base, version: state.version, openMajors: majors, readyForDecision: blockers.length === 1, phase, decisionBlockers: blockers };
  };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\?/, route => route.fulfill(ok([{ id: 901, name: "Nile Foods", reference: "AC-901", customer: true, prospect: false }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/business-lines$/, route => route.fulfill(ok([
    { id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 10, responsibleTeam: null }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/certification\//, route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti\/certification/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : null;
    requests.push({ method, path, body });
    const refusal = method === "POST" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path.startsWith("/cycles?")) {
      if (failures > 0) { failures--; return route.fulfill({ status: 500, body: "{}" }); }
      return route.fulfill(ok(url.searchParams.get("q") === "none" ? [] : [cycle()]));
    }
    if (path === "/cycles/61") return route.fulfill(ok(cycle()));
    if (path === "/cycles/61/audits" && method === "GET") return route.fulfill(ok(state.audits));
    if (path === "/cycles/61/timeline") return route.fulfill(ok([{ at: "2026-10-01T09:00:00", kind: "CYCLE_OPENED", label: "CYC-NILE", actorName: null }]));
    if (path.startsWith("/cycles/61/eligible-auditors")) return route.fulfill(ok(url.searchParams.get("date") === "2027-03-01" ? [] : [{ id: 7, name: "Ahmed Auditor" }]));
    if (path === "/cycles/61/audits") {
      const b = body as Record<string, unknown>;
      const audit = { id: 80 + state.audits.length, version: 0, type: b.type, plannedDate: b.plannedDate, auditorId: b.auditorId,
        auditorName: "Ahmed Auditor", status: "PLANNED", completedOn: null };
      state.audits.push(audit); state.version++; return route.fulfill(ok(audit, 201));
    }
    const complete = path.match(/^\/audits\/(\d+)\/complete$/);
    if (complete) {
      const audit = state.audits.find(a => a.id === Number(complete[1]))!;
      Object.assign(audit, { status: "COMPLETED", completedOn: (body as Record<string, unknown>).completedOn, version: (audit.version as number) + 1 });
      state.version++; return route.fulfill(ok(audit));
    }
    const ncs = path.match(/^\/audits\/(\d+)\/nonconformities$/);
    if (ncs && method === "GET") return route.fulfill(ok(state.ncs.filter(n => n.auditId === Number(ncs[1]))));
    if (ncs) {
      const b = body as Record<string, unknown>;
      const nc = { id: 300 + state.ncs.length, version: 0, auditId: Number(ncs[1]), grade: b.grade, clause: b.clause, statement: b.statement,
        clientResponse: null, status: "OPEN", raisedAt: null, respondedAt: null, closedAt: null };
      state.ncs.push(nc); const audit = state.audits.find(a => a.id === Number(ncs[1]))!; audit.version = (audit.version as number) + 1;
      return route.fulfill(ok(nc, 201));
    }
    const ncAction = path.match(/^\/nonconformities\/(\d+)\/(respond|close)$/);
    if (ncAction) {
      const nc = state.ncs.find(n => n.id === Number(ncAction[1]))!;
      if (ncAction[2] === "respond") Object.assign(nc, { status: "RESPONDED", clientResponse: (body as Record<string, unknown>).response });
      else Object.assign(nc, { status: "CLOSED" });
      nc.version = (nc.version as number) + 1; return route.fulfill(ok(nc));
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  return { requests, answers, fail };
}

test("certification: register filters and paging are sent to the server; empty and retry states", async ({page}) => {
  const { requests } = await certificationMocks(page, { failList: 1 });
  await page.goto("/#/certification");
  await expect(page.getByRole("heading", { name: "شهادات الأيزو للعملاء" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("تعذّر تنفيذ الطلب");
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByText("Nile Foods")).toBeVisible();
  await expect(page.locator(".cert-row .cert-phase")).toHaveText("بانتظار المرحلة الأولى");
  await page.getByLabel("كل المراحل").selectOption("FINDINGS_OPEN");
  await page.getByLabel("دوراتي فقط").check();
  await page.getByPlaceholder("ابحث بالمرجع أو اسم العميل").fill("none");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByText("لا توجد دورات اعتماد مطابقة")).toBeVisible();
  const last = requests.filter(r => r.path.startsWith("/cycles?")).at(-1)!.path;
  expect(new URLSearchParams(last.split("?")[1])).toEqual(new URLSearchParams("q=none&phase=FINDINGS_OPEN&mine=true&limit=25&offset=0"));
  await expect(page.locator("body")).not.toContainText("c0ffee01");
});

test("certification: Stage 1 and 2 with server-chosen auditors, findings to closure, readiness explained, D-02 blocked", async ({page}) => {
  const { requests, answers, fail } = await certificationMocks(page);
  await page.goto("/#/certification/61");
  await expect(page.getByRole("heading", { name: "Nile Foods" })).toBeVisible();
  await expect(page.getByRole("button", { name: "قرار الاعتماد" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "إصدار الشهادة" })).toBeDisabled();
  // no open major yet: Stage 1, Stage 2 and the policy block the decision
  await expect(page.locator(".cert-readiness li.is-blocked")).toHaveCount(3);
  const stage1 = page.locator(".cert-stage").first();
  await stage1.getByLabel("تاريخ التدقيق المخطط").fill("2027-03-01");
  await expect(stage1.getByText(/لا يوجد مدقق مؤهل لهذا المعيار/)).toBeVisible();
  await stage1.getByLabel("تاريخ التدقيق المخطط").fill("2026-11-10");
  await stage1.getByLabel("المدقق الرئيسي").selectOption("7");
  answers.push(fail(422, "VALIDATION_FAILED", "auditorId", "NOT_QUALIFIED"));
  await stage1.getByRole("button", { name: "تخطيط التدقيق" }).click();
  await expect(page.getByRole("alert")).toHaveText(/المدقق غير مؤهل لهذا المعيار/);
  await stage1.getByLabel("المدقق الرئيسي").selectOption("7");
  await stage1.getByRole("button", { name: "تخطيط التدقيق" }).click();
  await expect(stage1.getByText("Ahmed Auditor")).toBeVisible();
  expect(requests.filter(r => r.path === "/cycles/61/audits" && r.method === "POST").at(-1)!.body).toEqual({ version: 3, type: "STAGE1", plannedDate: "2026-11-10", auditorId: 7 });
  const stage2 = page.locator(".cert-stage").nth(1);
  await expect(stage2.getByText(/لا تُسجل كمكتملة قبل إتمام المرحلة الأولى/)).toBeVisible();
  await stage1.getByRole("button", { name: "تسجيل الإتمام" }).click();
  await expect(stage1.getByText("مكتمل")).toBeVisible();
  await expect(page.locator(".cert-readiness li.is-done")).toHaveCount(2);
  await stage1.getByLabel("الدرجة").selectOption("MAJOR");
  await stage1.getByLabel("البند").fill("7.1.5");
  await stage1.getByLabel("بيان عدم المطابقة").fill("Calibration records missing");
  await stage1.getByRole("button", { name: "تسجيل ملاحظة" }).click();
  await expect(stage1.locator(".cert-nc-major")).toContainText("Calibration records missing");
  await expect(page.locator(".cert-readiness li.is-blocked")).toContainText(["المرحلة الثانية", "عدم المطابقات الجسيمة", "D-02"]);
  answers.push(fail(422, "RESPONSE_REQUIRED"));
  await stage1.getByRole("button", { name: "إغلاق بعد التحقق" }).click();
  await expect(page.getByRole("alert")).toHaveText(/سجّل رد العميل قبل الإغلاق/);
  await stage1.getByPlaceholder("تصحيح العميل وإجراءه التصحيحي").fill("Scales calibrated");
  await stage1.getByRole("button", { name: "تسجيل رد العميل" }).click();
  await expect(stage1.locator(".cert-nc")).toContainText("تم الرد");
  await stage1.getByRole("button", { name: "إغلاق بعد التحقق" }).click();
  await expect(stage1.locator(".cert-nc")).toContainText("مغلقة");
  await stage2.getByLabel("تاريخ التدقيق المخطط").fill("2026-12-01");
  await stage2.getByLabel("المدقق الرئيسي").selectOption("7");
  answers.push(fail(409, "CONFLICT"));
  await stage2.getByRole("button", { name: "تخطيط التدقيق" }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل البيانات من مكان آخر/);
  await stage2.getByLabel("تاريخ التدقيق المخطط").fill("2026-12-02");
  await stage2.getByLabel("المدقق الرئيسي").selectOption("7");
  await stage2.getByRole("button", { name: "تخطيط التدقيق" }).click();
  await stage2.getByRole("button", { name: "تسجيل الإتمام" }).click();
  await expect(page.locator(".cert-phase").first()).toContainText("جاهزة لقرار الاعتماد");
  await expect(page.locator(".cert-readiness li.is-blocked")).toHaveCount(1);
  await expect(page.locator(".cert-readiness li.is-blocked")).toContainText("D-02");
  await page.screenshot({ path: "test-results/ioeti-certification.png", fullPage: true });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("certification: a cycle managed by someone else is read only; mobile layout keeps one column", async ({page}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await certificationMocks(page, { managedByMe: false });
  await page.goto("/#/certification/61");
  await expect(page.getByText("عرض فقط: مدير البرنامج وحده يعدّل هذه الدورة.")).toBeVisible();
  await expect(page.getByRole("button", { name: "تخطيط التدقيق" })).toHaveCount(0);
  const widths = await page.locator(".cert-stage").evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)));
  expect(widths.length).toBe(2);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

async function recruitmentMocks(page: Page, options: { mine?: boolean; failList?: number } = {}) {
  await intercept(page);
  const mine = options.mine ?? true;
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, field?: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee02", fields: field ? [{ field, code: "INVALID", message: "x" }] : [] } }) });
  let failures = options.failList ?? 0;
  const state = { orderVersion: 1, consent: false, privateOnFile: false, candVersion: 0, status: "OPEN",
    apps: [] as Record<string, unknown>[], interviews: [] as Record<string, unknown>[], placements: [] as Record<string, unknown>[],
    consents: [] as Record<string, unknown>[] };
  const order = () => ({ id: 41, version: state.orderVersion, reference: "JO-NILE", clientId: 901, clientName: "Nile Hotels", title: "Front Office Manager",
    headcount: 1, location: "Cairo", requirements: "Five years in hotel front office", status: state.status,
    activeCandidates: state.apps.filter(a => !["PLACED", "REJECTED", "WITHDRAWN"].includes(a.stage as string)).length,
    placed: state.placements.length, recruitedByMe: mine, recruiterName: "Rana" });
  const candidate = () => ({ id: 51, version: state.candVersion, displayName: "Salma Hassan", headline: "Front office supervisor", yearsExperience: 6,
    privateProfileOnFile: state.privateOnFile, ownedByMe: mine });
  const bump = (a: Record<string, unknown>, changes: Record<string, unknown>) => Object.assign(a, changes, { version: (a.version as number) + 1, consentOnFile: state.consent });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\?/, route => route.fulfill(ok([{ id: 901, name: "Nile Hotels", reference: "AC-901", customer: true, prospect: false }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/recruitment\//, route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti\/recruitment/, "") + url.search;
    const method = route.request().method();
    const body = (method === "POST" || method === "PUT") ? route.request().postDataJSON() as Record<string, unknown> : {};
    requests.push({ method, path, body });
    const refusal = method !== "GET" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path.startsWith("/job-orders") && method === "GET" && !/\d/.test(path.split("?")[0])) {
      if (failures > 0) { failures--; return route.fulfill({ status: 500, body: "{}" }); }
      return route.fulfill(ok(url.searchParams.get("q") === "none" ? [] : [order()]));
    }
    if (path === "/job-orders" && method === "POST") return route.fulfill(ok(order(), 201));
    if (path === "/job-orders/41") return route.fulfill(ok(order()));
    if (path === "/job-orders/41/placements") return route.fulfill(ok(state.placements));
    if (path === "/job-orders/41/applications" && method === "GET") return route.fulfill(ok(state.apps.map(a => ({ ...a, consentOnFile: state.consent }))));
    if (path === "/job-orders/41/applications") {
      const app = { id: 71, version: 0, jobOrderId: 41, candidateId: body.candidateId, candidateName: "Salma Hassan", candidateHeadline: "Front office supervisor",
        stage: "SOURCED", submittedAt: null, offerDate: null, offerStatus: null, consentOnFile: state.consent };
      state.apps.push(app); state.orderVersion++; return route.fulfill(ok(app, 201));
    }
    if (path.startsWith("/candidates?") || path === "/candidates") return route.fulfill(ok([candidate()]));
    if (path === "/candidates/51" ) return route.fulfill(ok(candidate()));
    if (path === "/candidates/51/private") { state.privateOnFile = true; state.candVersion++; return route.fulfill(ok(candidate())); }
    if (path === "/candidates/51/consents" && method === "GET") return route.fulfill(ok(state.consents));
    if (path === "/candidates/51/consents") {
      const consent = { id: 91, version: 0, jobOrderId: body.jobOrderId, jobOrderReference: "JO-NILE", method: body.method, givenOn: body.givenOn,
        evidenceReference: body.evidenceReference ?? null, revokedAt: null, active: true };
      state.consents.push(consent); state.consent = true; state.candVersion++; return route.fulfill(ok(consent, 201));
    }
    if (path === "/consents/91/revoke") {
      Object.assign(state.consents[0], { revokedAt: "2026-10-20T10:00:00", active: false }); state.consent = false;
      return route.fulfill(ok(state.consents[0]));
    }
    const app = state.apps[0];
    if (path === "/applications/71/stage") return route.fulfill(ok(bump(app, { stage: body.stage })));
    if (path === "/applications/71/submit") {
      if (!state.consent) return route.fulfill(fail(422, "CONSENT_REQUIRED"));
      return route.fulfill(ok(bump(app, { stage: "SUBMITTED", submittedAt: "2026-10-20T10:00:00" })));
    }
    if (path === "/applications/71/interviews" && method === "GET") return route.fulfill(ok(state.interviews));
    if (path === "/applications/71/interviews") {
      const interview = { id: 81, version: 0, round: body.round, scheduledAt: body.scheduledAt + ":00", outcome: "PENDING" };
      state.interviews.push(interview); bump(app, { stage: "INTERVIEWING" }); return route.fulfill(ok(interview, 201));
    }
    if (path === "/interviews/81/outcome") { Object.assign(state.interviews[0], { outcome: body.outcome, version: 1 }); bump(app, {}); return route.fulfill(ok(state.interviews[0])); }
    if (path === "/applications/71/offer") return route.fulfill(ok(bump(app, { stage: "OFFERED", offerDate: body.offerDate, offerStatus: "PENDING" })));
    if (path === "/applications/71/offer-answer") return route.fulfill(ok(bump(app, { offerStatus: body.accepted ? "ACCEPTED" : "DECLINED" })));
    if (path === "/applications/71/placement") {
      bump(app, { stage: "PLACED" }); state.status = "FILLED"; state.orderVersion++;
      const placement = { id: 95, version: 0, applicationId: 71, candidateName: "Salma Hassan", startDate: body.startDate, guaranteeStatus: "TERMS_PENDING",
        feeMilestones: ["OFFER_ACCEPTED"], invoicingStatus: "BLOCKED_BY_POLICY" };
      state.placements.push(placement); return route.fulfill(ok(placement, 201));
    }
    if (path === "/placements/95/started") {
      Object.assign(state.placements[0], { feeMilestones: ["OFFER_ACCEPTED", "CANDIDATE_STARTED"] }); return route.fulfill(ok(state.placements[0]));
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  return { requests, answers, fail };
}

test("recruitment: registers with search, retry and empty states; a job order is opened for a client", async ({page}) => {
  const { requests } = await recruitmentMocks(page, { failList: 1 });
  await page.goto("/");
  await page.locator("button.nav-item").filter({ hasText: "التوظيف" }).click();
  await expect(page.getByRole("heading", { name: "التوظيف للعملاء" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("تعذّر تنفيذ الطلب");
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.locator(".rec-row")).toContainText("Front Office Manager");
  await expect(page.locator(".rec-row .rec-status")).toHaveText("مفتوح");
  await expect(page.locator(".rec-row .rec-count")).toHaveText("0/1");
  await page.getByPlaceholder("ابحث بالمرجع أو المسمى الوظيفي").fill("none");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByText("لا توجد طلبات توظيف")).toBeVisible();
  expect(requests.filter(r => r.path.startsWith("/job-orders?")).at(-1)!.path).toBe("/job-orders?q=none");
  await page.getByRole("button", { name: "طلب توظيف جديد" }).click();
  await page.getByLabel("المرجع", { exact: true }).fill("JO-NILE");
  await page.getByLabel("العميل").selectOption("901");
  await page.getByLabel("المسمى الوظيفي", { exact: true }).fill("Front Office Manager");
  await page.getByLabel("عدد الوظائف").fill("1");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/recruitment\/orders\/41$/);
  expect(requests.find(r => r.path === "/job-orders" && r.method === "POST")!.body).toEqual({ reference: "JO-NILE", clientId: 901, title: "Front Office Manager", headcount: 1 });
  await page.goto("/#/recruitment/candidates");
  await expect(page.locator(".directory-item")).toContainText("Salma Hassan");
  await expect(page.locator(".rec-private")).toHaveText("غير مسجلة");
});

test("recruitment: pipeline from sourcing to placement; consent required to submit; D-04 actions blocked; stale 409", async ({page}) => {
  const { requests, answers, fail } = await recruitmentMocks(page);
  await page.goto("/#/recruitment/orders/41");
  await expect(page.getByRole("heading", { name: "Front Office Manager" })).toBeVisible();
  await expect(page.getByRole("link", { name: "العميل" })).toHaveAttribute("href", "#/accounts/901");
  await page.getByLabel("إضافة مرشح للمسار").selectOption("51");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  const sourced = page.getByRole("listitem", { name: "مصدر" });
  await expect(sourced.locator(".rec-card")).toContainText("لا توجد موافقة سارية لهذا الطلب");
  expect(requests.find(r => r.path === "/job-orders/41/applications" && r.method === "POST")!.body).toEqual({ version: 1, candidateId: 51 });
  await sourced.locator(".rec-card").click();
  answers.push(fail(409, "CONFLICT"));
  await page.getByRole("button", { name: "تم الفرز", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل البيانات من مكان آخر/);
  await page.getByRole("button", { name: "تم الفرز", exact: true }).click();
  await page.getByRole("button", { name: "إلى القائمة المختصرة" }).click();
  await expect(page.getByRole("listitem", { name: "القائمة المختصرة" }).locator(".rec-card")).toBeVisible();
  await expect(page.getByRole("button", { name: "مشاركة السيرة الذاتية" })).toBeDisabled();
  await expect(page.locator("#rec-submit-note")).toContainText("D-04");
  await page.getByRole("button", { name: "ترشيح للعميل" }).click();
  await expect(page.getByRole("alert")).toHaveText(/سجّل موافقة المرشح على هذا الطلب قبل ترشيحه للعميل/);
  // the recruiter records the consent on the candidate record, then submits
  await page.goto("/#/recruitment/candidates/51");
  await page.getByLabel("طلب التوظيف").selectOption("41");
  await page.getByLabel("مرجع الإثبات").fill("EV-2026-17");
  await page.getByRole("button", { name: "تسجيل موافقة" }).click();
  await expect(page.locator(".rec-list")).toContainText("JO-NILE");
  await page.goto("/#/recruitment/orders/41");
  await page.getByRole("listitem", { name: "القائمة المختصرة" }).locator(".rec-card").click();
  await expect(page.locator(".rec-application .rec-consent-ok")).toBeVisible();
  await page.getByRole("button", { name: "ترشيح للعميل" }).click();
  await expect(page.getByRole("listitem", { name: "مُرشح للعميل" }).locator(".rec-card")).toBeVisible();
  await page.getByLabel("الموعد").fill("2026-11-12T10:00");
  await page.getByRole("button", { name: "جدولة مقابلة" }).click();
  await page.getByRole("button", { name: "اجتاز", exact: true }).click();
  await expect(page.locator(".rec-application .rec-list")).toContainText("اجتاز");
  await page.getByLabel("تاريخ العرض").fill("2026-11-20");
  await page.getByRole("button", { name: "تسجيل عرض العميل" }).click();
  await page.getByRole("button", { name: "قَبِل العرض" }).click();
  await page.getByLabel("تاريخ بدء العمل").fill("2026-12-01");
  answers.push(fail(422, "HEADCOUNT_FILLED"));
  await page.getByRole("button", { name: "تأكيد التعيين" }).click();
  await expect(page.getByRole("alert")).toHaveText(/اكتملت كل وظائف هذا الطلب/);
  await page.getByLabel("تاريخ بدء العمل").fill("2026-12-01");
  await page.getByRole("button", { name: "تأكيد التعيين" }).click();
  const placements = page.locator("table");
  await expect(placements).toContainText("Salma Hassan");
  await expect(placements).toContainText("شروط الضمان بانتظار السياسة D-04");
  await expect(placements).toContainText("قبول العرض");
  await page.getByRole("button", { name: "تسجيل بدء العمل" }).click();
  await expect(placements).toContainText("بدء العمل");
  await expect(page.getByRole("button", { name: "إصدار فاتورة الأتعاب" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "طلب بديل" })).toBeDisabled();
  await expect(page.locator(".record-tags .rec-status")).toHaveText("مكتمل");
  expect(requests.filter(r => r.path === "/applications/71/submit").map(r => r.body)).toEqual([{ version: 2 }, { version: 2 }]);
  expect(requests.some(r => /share-cv|invoice|replacement/.test(r.path))).toBe(false);
  await page.screenshot({ path: "test-results/ioeti-recruitment.png", fullPage: true });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("recruitment: restricted candidate data is write-only; consent revocation; read-only and mobile", async ({page}) => {
  const { requests } = await recruitmentMocks(page);
  await page.goto("/#/recruitment/candidates/51");
  await expect(page.getByRole("heading", { name: "Salma Hassan" })).toBeVisible();
  await expect(page.locator(".rec-private-card .record-section-header p")).toHaveText("غير مسجلة");
  await page.getByLabel("البريد الإلكتروني").fill("salma.private@example.invalid");
  await page.getByLabel("الهاتف").fill("+20 100 555 0101");
  await page.getByLabel("الراتب المتوقع").fill("18000");
  await page.getByRole("button", { name: "تسجيل البيانات المقيّدة" }).click();
  await expect(page.locator(".rec-private-card .record-section-header p")).toHaveText("مسجلة (لا تُعرض)");
  await expect(page.getByLabel("البريد الإلكتروني")).toHaveValue("");
  expect(requests.find(r => r.method === "PUT")!.body).toEqual({ version: 0, email: "salma.private@example.invalid", phone: "+20 100 555 0101", expectedSalary: "18000" });
  expect(requests.some(r => r.method === "GET" && r.path.endsWith("/private"))).toBe(false);
  await expect(page.locator("body")).not.toContainText("salma.private@example.invalid");
  await page.getByLabel("طلب التوظيف").selectOption("41");
  await page.getByRole("button", { name: "تسجيل موافقة" }).click();
  await page.getByRole("button", { name: "سحب الموافقة" }).click();
  await expect(page.locator(".rec-list")).toContainText("مسحوبة");
});

test("recruitment: someone else's job order is read only; the board stacks on mobile without horizontal scroll", async ({page}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recruitmentMocks(page, { mine: false });
  await page.goto("/#/recruitment/orders/41");
  await expect(page.getByText("عرض فقط: المسؤول وحده يعدّل هذا السجل.")).toBeVisible();
  await expect(page.getByRole("button", { name: "إضافة", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعليق" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto("/#/recruitment/candidates/51");
  await expect(page.getByRole("button", { name: "تسجيل البيانات المقيّدة" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تسجيل موافقة" })).toHaveCount(0);
});

async function fundraisingMocks(page: Page, options: { mine?: boolean; failOverview?: number; empty?: boolean } = {}) {
  await intercept(page);
  const mine = options.mine ?? true;
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, field?: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee03", fields: field ? [{ field, code: "INVALID", message: "x" }] : [] } }) });
  let failures = options.failOverview ?? 0;
  const s = { donorVersion: 0, sensitive: false, oppVersion: 0, stage: "IDENTIFIED", commitVersion: 0, committed: 0, restricted: false, purpose: null as string | null,
    installments: [] as Record<string, unknown>[], collections: [] as Record<string, unknown>[], deliverables: [] as Record<string, unknown>[],
    events: [{ at: "2026-10-01T09:00:00", kind: "OPPORTUNITY_OPENED", label: "GR-NILE", actorName: "Hana" }] as Record<string, unknown>[] };
  const donor = () => ({ id: 21, version: s.donorVersion, partnerId: 901, name: "Nile Delta Foundation", anonymous: false, donorType: "FOUNDATION",
    managedByMe: mine, managerName: "Hana", sensitiveOnFile: s.sensitive, openOpportunities: 1 });
  const anonymous = { id: 22, version: 0, partnerId: null, name: null, anonymous: true, donorType: "INDIVIDUAL", managedByMe: false, managerName: "Omar", sensitiveOnFile: false, openOpportunities: 0 };
  const collected = () => s.collections.filter(k => k.status === "RECORDED").reduce((t, k) => t + Number(k.amount), 0);
  const scheduled = () => s.installments.filter(i => i.status !== "CANCELLED").reduce((t, i) => t + Number(i.amount), 0);
  const opp = () => ({ id: 31, version: s.oppVersion, reference: "GR-NILE", donorId: 21, donorName: "Nile Delta Foundation", title: "STEM scholarships for girls",
    purpose: "Scholarships", kind: "GRANT", stage: s.stage, proposedAmount: "500000.00", currency: "EGP", deadline: "2026-12-31", campaignId: 5,
    campaignName: "Scholarships 2026", renewalOf: null, commitmentId: s.committed ? 41 : null, archived: false, managedByMe: mine });
  const commitment = () => ({ id: 41, version: s.commitVersion, opportunityId: 31, reference: "GR-NILE", title: "STEM scholarships for girls", donorName: "Nile Delta Foundation",
    currency: "EGP", committed: s.committed, scheduled: scheduled(), collected: collected(), outstanding: s.committed - collected(), unscheduled: s.committed - scheduled(),
    restricted: s.restricted, restrictionPurpose: s.purpose, agreementReference: "AGR-7", approvedOn: "2026-10-01", periodEnd: "2027-09-30",
    pendingDeliverables: 0, receiptStatus: "BLOCKED_BY_POLICY", accountingStatus: "BLOCKED_BY_POLICY", managedByMe: mine });
  const totals = () => options.empty ? [] : [{ currency: "EGP", proposed: s.committed ? 0 : 500000, committed: s.committed, scheduled: scheduled(), collected: collected(),
    outstanding: s.committed - collected(), restrictedCommitted: s.restricted ? s.committed : 0 }];
  const instView = (i: Record<string, unknown>) => {
    const c = s.collections.filter(k => k.installmentId === i.id && k.status === "RECORDED").reduce((t, k) => t + Number(k.amount), 0);
    return { ...i, collected: c, status: i.status === "CANCELLED" ? "CANCELLED" : c >= Number(i.amount) ? "COLLECTED" : c > 0 ? "PARTIAL" : i.dueDate as string < "2026-10-20" ? "OVERDUE" : "DUE" };
  };
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/accounts\?/, route => route.fulfill(ok([{ id: 901, name: "Nile Delta Foundation", reference: "AC-901", customer: false, prospect: true }])));
  await page.route(/\/axelor-erp\/ws\/ioeti\/fundraising\//, route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti\/fundraising/, "") + url.search;
    const method = route.request().method();
    const body = (method === "POST" || method === "PUT") ? route.request().postDataJSON() as Record<string, unknown> : {};
    requests.push({ method, path, body });
    const refusal = method !== "GET" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path === "/overview") {
      if (failures > 0) { failures--; return route.fulfill({ status: 500, body: "{}" }); }
      const attention = s.installments.map(instView).filter(i => i.status === "OVERDUE").map(i => ({ ...i, commitmentId: 41, reference: "GR-NILE", donorName: "Nile Delta Foundation", currency: "EGP" }));
      return route.fulfill(ok({ totals: totals(), stages: { IDENTIFIED: s.stage === "IDENTIFIED" ? 1 : 0, PROPOSAL: 0, SUBMITTED: 0, APPROVED: s.committed ? 1 : 0, DECLINED: 0, WITHDRAWN: 0 },
        attention: options.empty ? [] : attention.length ? attention : [{ id: 99, commitmentId: 41, reference: "GR-NILE", donorName: null, sequence: 1, dueDate: "2026-10-01",
          amount: 1000, collected: 0, currency: "EGP", status: "OVERDUE" }], opportunities: options.empty ? 0 : 1 }));
    }
    if (path.startsWith("/collections?") || path === "/collections") return route.fulfill(ok([]));
    if (path === "/campaigns") return route.fulfill(ok([{ id: 5, name: "Scholarships 2026" }]));
    if (path.startsWith("/donors") && method === "GET" && !/\d/.test(path.split("?")[0])) return route.fulfill(ok(options.empty ? [] : [donor(), anonymous]));
    if (path === "/donors" && method === "POST") return route.fulfill(ok(donor(), 201));
    if (path === "/donors/21") return route.fulfill(ok({ donor: donor(), totals: totals() }));
    if (path === "/donors/21/sensitive") { s.sensitive = true; s.donorVersion++; return route.fulfill(ok(donor())); }
    if (path === "/donors/21/timeline") return route.fulfill(ok(s.events));
    if (path === "/donors/21/stewardship") { s.events.unshift({ at: body.occurredOn + "T00:00:00", kind: body.kind, label: body.subject, actorName: "Hana" }); s.donorVersion++; return route.fulfill(ok(donor(), 201)); }
    if (path.startsWith("/opportunities?")) return route.fulfill(ok([opp()]));
    if (path === "/opportunities/31") return route.fulfill(ok(opp()));
    if (path === "/opportunities/31/stage") { s.stage = body.stage as string; s.oppVersion++; return route.fulfill(ok(opp())); }
    if (path === "/opportunities/31/approve") {
      s.stage = "APPROVED"; s.committed = Number(body.committedAmount); s.restricted = body.restricted === true; s.purpose = (body.restrictionPurpose as string) ?? null; s.oppVersion++;
      s.events.unshift({ at: "2026-10-01T00:00:00", kind: "COMMITMENT_APPROVED", label: "GR-NILE", actorName: "Hana" });
      return route.fulfill(ok(commitment(), 201));
    }
    if (path === "/commitments/41") return route.fulfill(ok(commitment()));
    if (path === "/commitments/41/installments" && method === "GET") return route.fulfill(ok(s.installments.map(instView)));
    if (path === "/commitments/41/installments") {
      if (scheduled() + Number(body.amount) > s.committed) return route.fulfill(fail(422, "SCHEDULE_EXCEEDS_COMMITMENT"));
      const i = { id: 50 + s.installments.length, version: 0, sequence: s.installments.length + 1, dueDate: body.dueDate, amount: Number(body.amount), status: "SCHEDULED" };
      s.installments.push(i); s.commitVersion++; return route.fulfill(ok(instView(i), 201));
    }
    if (path === "/commitments/41/deliverables" && method === "GET") return route.fulfill(ok(s.deliverables));
    const inst = path.match(/^\/installments\/(\d+)\/collections$/);
    if (inst && method === "GET") return route.fulfill(ok(s.collections.filter(k => k.installmentId === Number(inst[1])).map(({ installmentId, ref, ...k }) => k)));
    if (inst) {
      if (s.collections.some(k => k.ref === body.bankReference)) return route.fulfill(fail(409, "DUPLICATE_COLLECTION"));
      const k = { id: 70 + s.collections.length, version: 0, installmentId: Number(inst[1]), ref: body.bankReference, amount: Number(body.amount), receivedOn: body.receivedOn,
        status: "RECORDED", voidReason: null, recordedBy: "Hana", receiptStatus: "BLOCKED_BY_POLICY" };
      s.collections.push(k); const i = s.installments.find(x => x.id === Number(inst[1]))!; i.version = (i.version as number) + 1; s.commitVersion++;
      const { installmentId, ref, ...view } = k; return route.fulfill(ok(view, 201));
    }
    const voiding = path.match(/^\/collections\/(\d+)\/void$/);
    if (voiding) {
      const k = s.collections.find(x => x.id === Number(voiding[1]))!; Object.assign(k, { status: "VOIDED", voidReason: body.reason, version: (k.version as number) + 1 });
      const { installmentId, ref, ...view } = k; return route.fulfill(ok(view));
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  return { requests, answers, fail };
}

test("fundraising: overview keeps proposed, committed and collected apart; retry and attention list", async ({page}) => {
  await fundraisingMocks(page, { failOverview: 2 });
  await page.goto("/");
  await page.locator("button.nav-item").filter({ hasText: "التمويل" }).click();
  await expect(page.getByRole("heading", { name: "التمويل والشراكات" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("تعذّر تنفيذ الطلب");
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  const money = page.locator(".fund-money").first();
  await expect(money.locator(".fund-money-proposed dd")).toContainText("500");
  await expect(money.locator(".fund-money-collected dd")).toContainText("0");
  await expect(page.locator(".fund-note").first()).toContainText("التعهد ليس تحصيلًا");
  await expect(page.locator(".fund-table")).toContainText("مانح مجهول الاسم");
  await expect(page.locator(".fund-table .fund-state-overdue")).toHaveText("متأخر");
});

test("fundraising: empty real data shows no invented figures", async ({page}) => {
  await fundraisingMocks(page, { empty: true });
  await page.goto("/#/fundraising");
  await expect(page.getByText("لا توجد مبالغ مسجلة بعد")).toBeVisible();
  await expect(page.getByText("لا توجد أقساط تحتاج متابعة")).toBeVisible();
  await expect(page.locator(".fund-money")).toHaveCount(0);
  await page.getByRole("tab", { name: "المانحون" }).click();
  await expect(page.getByText("لا يوجد مانحون")).toBeVisible();
});

test("fundraising: donor 360 with write-only sensitive data, stewardship timeline and anonymous donors", async ({page}) => {
  const { requests } = await fundraisingMocks(page);
  await page.goto("/#/fundraising/donors");
  await expect(page.locator(".fund-row").nth(1)).toContainText("مانح مجهول الاسم");
  await page.getByRole("button", { name: "مانح جديد" }).click();
  await page.getByLabel("الحساب").selectOption("901");
  await page.getByLabel("طلب عدم ذكر اسمه").check();
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/fundraising\/donors\/21$/);
  expect(requests.find(r => r.path === "/donors" && r.method === "POST")!.body).toEqual({ partnerId: 901, donorType: "FOUNDATION", anonymous: true });
  await expect(page.getByRole("heading", { name: "Nile Delta Foundation" })).toBeVisible();
  await page.getByLabel("القدرة المتوقعة على العطاء").fill("7777777.77");
  await page.getByLabel("ملاحظة العلاقة").fill("Board chair prefers calls after 9pm");
  await page.getByRole("button", { name: "تسجيل البيانات الحساسة" }).click();
  await expect(page.locator(".fund-sensitive .record-section-header p")).toHaveText("مسجلة (لا تُعرض)");
  await expect(page.getByLabel("القدرة المتوقعة على العطاء")).toHaveValue("");
  expect(requests.find(r => r.method === "PUT")!.body).toEqual({ version: 0, givingCapacity: "7777777.77", relationshipNote: "Board chair prefers calls after 9pm" });
  expect(requests.some(r => r.method === "GET" && r.path.endsWith("/sensitive"))).toBe(false);
  await expect(page.locator("body")).not.toContainText("Board chair prefers");
  await page.getByLabel("الموضوع").fill("Thank-you call to the board");
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await expect(page.locator(".fund-timeline li").first()).toContainText("Thank-you call to the board");
  await expect(page.locator(".fund-timeline")).toContainText("فُتحت فرصة");
});

test("fundraising: grant from proposal to commitment, schedule within the commitment, collections without duplicates, D-05/D-06 blocked", async ({page}) => {
  const { requests, answers, fail } = await fundraisingMocks(page);
  await page.goto("/#/fundraising/opportunities/31");
  await expect(page.getByRole("heading", { name: "STEM scholarships for girls" })).toBeVisible();
  answers.push(fail(409, "CONFLICT"));
  await page.getByRole("button", { name: "بدء إعداد المقترح" }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل البيانات من مكان آخر/);
  await page.getByRole("button", { name: "بدء إعداد المقترح" }).click();
  await page.getByRole("button", { name: "تسجيل التقديم للمانح" }).click();
  await expect(page.locator(".record-tags .fund-stage")).toHaveText("مقدم للمانح");
  await page.getByLabel("المبلغ الملتزم به").fill("400000");
  await page.getByLabel("تمويل مقيّد بغرض").check();
  await page.getByLabel("الغرض المقيّد").fill("Girls' STEM scholarships");
  await page.getByRole("button", { name: "تسجيل الاعتماد" }).click();
  const money = page.locator(".fund-money");
  await expect(money.locator(".fund-money-committed dd")).toContainText("400");
  await expect(money.locator(".fund-money-collected dd")).toContainText("0");
  await expect(page.locator(".fund-restricted")).toContainText("Girls' STEM scholarships");
  for (const label of ["توزيع الأموال المقيدة", "إصدار فاتورة", "إصدار إيصال تبرع", "ترحيل للحسابات"]) await expect(page.getByRole("button", { name: label })).toBeDisabled();
  await expect(page.locator("#fund-blocked-note")).toContainText("D-05");
  await page.getByLabel("تاريخ الاستحقاق").first().fill("2026-10-15");
  await page.getByLabel("المبلغ", { exact: true }).fill("500000");
  await page.getByRole("button", { name: "إضافة قسط" }).click();
  await expect(page.getByRole("alert")).toHaveText(/مجموع الأقساط سيتجاوز المبلغ الملتزم به/);
  await page.getByLabel("المبلغ", { exact: true }).fill("150000");
  await page.getByRole("button", { name: "إضافة قسط" }).click();
  await page.locator(".fund-installment-head").first().click();
  const inst = page.locator(".fund-installment").first();
  await inst.getByLabel("المبلغ", { exact: true }).fill("100000");
  await inst.getByLabel("مرجع التحويل البنكي").fill("NBE-2026-0001");
  await inst.getByRole("button", { name: "تسجيل تحصيل" }).click();
  await expect(inst.locator(".fund-state")).toHaveText("محصل جزئيًا");
  await expect(money.locator(".fund-money-collected dd")).toContainText("100");
  await inst.getByLabel("المبلغ", { exact: true }).fill("50000");
  await inst.getByLabel("مرجع التحويل البنكي").fill("NBE-2026-0001");
  await inst.getByRole("button", { name: "تسجيل تحصيل" }).click();
  await expect(page.getByRole("alert")).toHaveText(/هذا التحويل مسجل بالفعل/);
  await inst.getByRole("button", { name: "إلغاء التحصيل: مبلغ خاطئ" }).click();
  await expect(inst.locator(".fund-list li.is-voided")).toContainText("ملغى (مبلغ خاطئ)");
  await expect(money.locator(".fund-money-collected dd")).not.toContainText("100");
  await expect(page.locator("body")).not.toContainText("NBE-2026-0001");
  expect(requests.find(r => r.path === "/opportunities/31/approve")!.body).toEqual({ version: 2, committedAmount: "400000", approvedOn: expect.any(String), restricted: true, restrictionPurpose: "Girls' STEM scholarships" });
  expect(requests.some(r => /receipt|post|invoice|allocate/.test(r.path))).toBe(false);
  await page.screenshot({ path: "test-results/ioeti-fundraising.png", fullPage: true });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("fundraising: read-only for others; collection status filter; mobile without horizontal scroll", async ({page}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { requests } = await fundraisingMocks(page, { mine: false });
  await page.goto("/#/fundraising/opportunities/31");
  await expect(page.getByText("عرض فقط: مسؤول العلاقة وحده يعدّل هذا السجل.")).toBeVisible();
  await expect(page.getByRole("button", { name: "بدء إعداد المقترح" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto("/#/fundraising/donors/21");
  await expect(page.getByRole("button", { name: "تسجيل البيانات الحساسة" })).toHaveCount(0);
  await page.goto("/#/fundraising/collections");
  await page.getByLabel("كل الحالات").selectOption("OVERDUE");
  await expect.poll(() => requests.filter(r => r.path.startsWith("/collections")).at(-1)?.path).toBe("/collections?status=OVERDUE");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

async function operationsMocks(page: Page, options: { reviewer?: boolean; noReady?: boolean } = {}) {
  await intercept(page);
  const reviewer = options.reviewer ?? true;
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee04", fields: [] } }) });
  const s = { version: 0, status: "SUBMITTED", engagementId: null as number | null, lead: null as string | null, engVersion: 0, leadName: "Mona Ops",
    items: [
      { id: 11, version: 0, title: "Signed scope of work on file", mandatory: true, done: false, doneBy: null as string | null, doneAt: null as string | null, evidenceReference: null as string | null },
      { id: 12, version: 0, title: "Kick-off meeting planned", mandatory: true, done: false, doneBy: null as string | null, doneAt: null as string | null, evidenceReference: null as string | null },
      { id: 13, version: 0, title: "Client logo", mandatory: false, done: false, doneBy: null as string | null, doneAt: null as string | null, evidenceReference: null as string | null }],
    events: [{ id: 1, kind: "SUBMITTED", reason: null as string | null, actorName: "Sara Sales", at: "2026-10-20T09:00:00", fromUser: null as string | null, toUser: null as string | null, itemTitle: null as string | null }],
    tasks: [] as Record<string, unknown>[] };
  const handover = () => ({ id: 41, version: s.version, contractId: 7, contractReference: "CT-0007", contractName: "ISO 9001 certification - Nile Foods", clientId: 901,
    clientName: "Nile Foods", businessLineCode: "ISO9001", status: s.status, requestedBy: "Sara Sales", reviewedBy: s.status === "SUBMITTED" ? null : "Mona Ops",
    operationsLead: s.lead, submittedAt: "2026-10-20T09:00:00", decidedAt: null, engagementId: s.engagementId, items: s.items,
    missingRequired: s.items.filter(i => i.mandatory && !i.done).length, requestedByMe: !reviewer });
  const engagement = () => ({ id: 77, version: s.engVersion, code: "ENG-H41", name: "ISO 9001 certification - Nile Foods", clientId: 901, clientName: "Nile Foods",
    leadName: s.leadName, teamName: "Delivery", handoverId: 41, contractReference: "CT-0007", businessLineCode: "ISO9001", startedAt: "2026-10-20T00:00:00",
    tasks: s.tasks.length, tasksDone: s.tasks.filter(t => t.done).length, tasksOverdue: s.tasks.filter(t => t.overdue).length,
    progress: s.tasks.length ? Math.round(100 * s.tasks.filter(t => t.done).length / s.tasks.length) : 0, ledByMe: true });
  const event = (kind: string, extra: Record<string, unknown> = {}) => s.events.push({ id: s.events.length + 1, kind, reason: null, actorName: "Mona Ops", at: "2026-10-20T10:00:00", fromUser: null, toUser: null, itemTitle: null, ...extra });
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/operations\//, route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti\/operations/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() as Record<string, unknown> : {};
    requests.push({ method, path, body });
    const refusal = method !== "GET" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path === "/ready-contracts") return route.fulfill(ok(options.noReady ? [] : [{ id: 7, reference: "CT-0007", name: "ISO 9001 certification - Nile Foods", clientName: "Nile Foods" }]));
    if (path === "/people") return reviewer ? route.fulfill(ok([{ id: 5, name: "Mona Ops" }, { id: 6, name: "Karim Lead" }])) : route.fulfill(fail(403, "FORBIDDEN"));
    if (path.startsWith("/handovers") && method === "GET" && !/\d/.test(path.split("?")[0])) return route.fulfill(ok([handover()]));
    if (path === "/handovers" && method === "POST") return route.fulfill(ok(handover(), 201));
    if (path === "/handovers/41") return route.fulfill(ok(handover()));
    if (path === "/handovers/41/events") return route.fulfill(ok(s.events));
    const item = path.match(/^\/items\/(\d+)\/complete$/);
    if (item) {
      const it = s.items.find(i => i.id === Number(item[1]))!;
      Object.assign(it, { done: true, doneBy: "Sara Sales", doneAt: "2026-10-20T10:00:00", evidenceReference: body.evidenceReference ?? null, version: it.version + 1 });
      s.version++; event("ITEM_DONE", { itemTitle: it.title }); return route.fulfill(ok(handover()));
    }
    if (path === "/handovers/41/rework") { s.status = "REWORK_REQUESTED"; s.version++; event("REWORK_REQUESTED", { reason: body.reason }); return route.fulfill(ok(handover())); }
    if (path === "/handovers/41/accept") {
      if (s.items.some(i => i.mandatory && !i.done)) return route.fulfill(fail(422, "CHECKLIST_INCOMPLETE"));
      s.status = "ACCEPTED"; s.engagementId = 77; s.lead = "Mona Ops"; s.version++; event("ACCEPTED", { toUser: "Mona Ops" }); event("ENGAGEMENT_CREATED", { itemTitle: "ENG-H41" });
      return route.fulfill(ok(engagement(), 201));
    }
    if (path.startsWith("/engagements") && method === "GET" && !/\d/.test(path.split("?")[0])) return route.fulfill(ok(s.engagementId ? [engagement()] : []));
    if (path === "/engagements/77") return route.fulfill(ok(engagement()));
    if (path === "/engagements/77/tasks" && method === "GET") return route.fulfill(ok(s.tasks));
    if (path === "/engagements/77/tasks") {
      const t = { id: 90 + s.tasks.length, version: 0, name: body.name, dueDate: body.dueDate ?? null, assigneeName: body.assigneeId === 6 ? "Karim Lead" : null,
        status: "New", done: false, overdue: (body.dueDate as string ?? "9999") < "2026-10-20" };
      s.tasks.push(t); s.engVersion++; return route.fulfill(ok(t, 201));
    }
    const task = path.match(/^\/tasks\/(\d+)\/complete$/);
    if (task) { const t = s.tasks.find(x => x.id === Number(task[1]))!; Object.assign(t, { done: true, overdue: false, status: "Done", version: (t.version as number) + 1 }); return route.fulfill(ok(t)); }
    if (path === "/engagements/77/owner") { s.leadName = "Karim Lead"; s.engVersion++; event("OWNER_CHANGED", { fromUser: "Mona Ops", toUser: "Karim Lead" }); return route.fulfill(ok(engagement())); }
    return route.fulfill({ status: 404, body: "{}" });
  });
  return { requests, answers, fail };
}

test("operations: request a handover from a ready contract; when none is ready the D-11 gate is explained", async ({page}) => {
  const { requests } = await operationsMocks(page, { reviewer: false });
  await page.goto("/");
  await page.locator("button.nav-item").filter({ hasText: "التشغيل" }).click();
  await expect(page.getByRole("heading", { name: "التسليم والتشغيل" })).toBeVisible();
  await page.getByLabel("العقد").selectOption("7");
  await page.getByRole("button", { name: "إرسال للتشغيل" }).click();
  await expect(page).toHaveURL(/#\/operations\/handovers\/41$/);
  expect(requests.find(r => r.path === "/handovers" && r.method === "POST")!.body).toEqual({ contractId: 7 });
  // a salesperson sees no review controls (the server also refuses them)
  await expect(page.getByRole("button", { name: "قبول وإنشاء المشروع" })).toHaveCount(0);
  await page.unroute(/\/axelor-erp\/ws\/ioeti\/operations\//);
  await operationsMocks(page, { reviewer: false, noReady: true });
  await page.goto("/#/operations");
  await expect(page.getByText(/تفعيل العقد \(التوقيع\) متوقف حتى اعتماد D-11/)).toBeVisible();
});

test("operations: review against the checklist, rework, acceptance creates one engagement; trail and tasks", async ({page}) => {
  const { requests, answers, fail } = await operationsMocks(page);
  await page.goto("/#/operations/handovers/41");
  await expect(page.getByRole("heading", { name: "ISO 9001 certification - Nile Foods" })).toBeVisible();
  await expect(page.getByText("2 بنود مطلوبة متبقية")).toBeVisible();
  await page.getByLabel("مسؤول التشغيل").selectOption("5");
  await page.getByRole("button", { name: "قبول وإنشاء المشروع" }).click();
  await expect(page.getByRole("alert")).toHaveText(/أكمل كل البنود المطلوبة قبل القبول/);
  await page.getByLabel("مرجع الإثبات · Signed scope of work on file").fill("DOC-SOW-17");
  await page.getByRole("button", { name: "تم: Signed scope of work on file" }).click();
  await expect(page.locator(".ops-checklist li.is-done")).toContainText("DOC-SOW-17");
  answers.push(fail(409, "CONFLICT"));
  await page.getByRole("button", { name: "تم: Kick-off meeting planned" }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل البيانات من مكان آخر/);
  await page.getByRole("button", { name: "تم: Kick-off meeting planned" }).click();
  await expect(page.locator(".ops-checklist li.is-done")).toHaveCount(2);
  await page.getByLabel("مسؤول التشغيل").selectOption("5");
  await page.getByRole("button", { name: "قبول وإنشاء المشروع" }).click();
  await expect(page.locator(".record-tags .ops-status")).toHaveText("مقبول");
  await expect(page.locator(".ops-trail")).toContainText("أُنشئ المشروع");
  expect(requests.filter(r => r.path === "/handovers/41/accept").at(-1)!.body).toMatchObject({ operationsLeadId: 5 });
  await page.getByRole("link", { name: "فتح المشروع" }).click();
  await expect(page).toHaveURL(/#\/operations\/engagements\/77$/);
  await page.getByLabel("المهمة").fill("Stage 1 audit plan");
  await page.getByRole("combobox", { name: "المسؤول", exact: true }).selectOption("6");
  await page.getByRole("button", { name: "إضافة مهمة" }).click();
  await page.getByLabel("المهمة").fill("Collect documents");
  await page.getByLabel("تاريخ الاستحقاق").fill("2026-10-01");
  await page.getByRole("button", { name: "إضافة مهمة" }).click();
  await expect(page.locator(".ops-checklist li.is-overdue")).toContainText("Collect documents");
  await page.getByRole("button", { name: "إنهاء: Stage 1 audit plan" }).click();
  await expect(page.locator(".ops-facts")).toContainText("50%");
  await page.getByLabel("إلى").selectOption("6");
  await page.getByRole("button", { name: "نقل المسؤولية" }).click();
  await expect(page.locator(".ops-facts")).toContainText("Karim Lead");
  await page.screenshot({ path: "test-results/ioeti-operations.png", fullPage: true });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("operations: rework with a reason is recorded; mobile layout without horizontal scroll", async ({page}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { requests } = await operationsMocks(page);
  await page.goto("/#/operations/handovers/41");
  await page.getByLabel("السبب").selectOption("MISSING_SCOPE");
  await page.getByRole("button", { name: "إعادة للاستكمال" }).click();
  await expect(page.locator(".record-tags .ops-status")).toHaveText("مطلوب استكمال");
  await expect(page.locator(".ops-trail")).toContainText("نطاق العمل غير مكتمل");
  expect(requests.find(r => r.path === "/handovers/41/rework")!.body).toEqual({ version: 0, reason: "MISSING_SCOPE" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

async function workflowMocks(page: Page, options: { quoteStatus?: string; contractStatus?: string } = {}) {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee05", fields: [] } }) });
  const line = (id: number, qty: string) => ({ id, productCode: "ISO-AUD-DAY", name: "Audit day", quantity: qty, unit: "Day", unitPriceBeforeTax: "1500.00",
    totalBeforeTax: String(1500 * Number(qty)) + ".00" });
  const s = { version: 3, versionNumber: 1, lines: [line(1, "2")], versions: [] as Record<string, unknown>[], reviews: [] as Record<string, unknown>[],
    requests: [] as Record<string, unknown>[], contractVersion: 1, renewed: false };
  const quote = () => ({ id: 7, version: s.version, reference: "SO-0007", status: options.quoteStatus ?? "DRAFT", opportunityId: 101, accountId: 901,
    accountName: "Nile View Hotel", currency: "EGP", totalBeforeTax: String(s.lines.reduce((t, l) => t + Number(l.totalBeforeTax), 0)), taxStatus: "BLOCKED_BY_POLICY",
    versionNumber: s.versionNumber, lines: s.lines });
  const plan = () => ({ quoteId: 7, quoteVersion: s.version, currency: "EGP", totalBeforeTax: "3000.00", plannedPercentage: "100", plannedAmountBeforeTax: "3000.00",
    bookingStatus: "NOT_BOOKED", bookedBeforeTax: "0", invoiced: "0", collected: "0", invoicingStatus: "BLOCKED_BY_POLICY",
    milestones: [{ id: 61, title: "Deposit", percentage: "30", amountBeforeTax: "900.00", dueDate: "2026-11-01", state: "PLANNED", invoiceReference: null }] });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(/\/axelor-erp\/ws\/ioeti\/(quotes|workspace|contracts)/, route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : null;
    requests.push({ method, path, body });
    const refusal = method === "POST" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path.startsWith("/quotes?")) return route.fulfill(ok([quote()]));
    if (path === "/quotes/7/milestones") return route.fulfill(ok(plan()));
    if (path === "/quotes/7/versions" && method === "GET") return route.fulfill(ok(s.versions));
    if (path === "/quotes/7/versions") {
      s.versions.unshift({ number: s.versionNumber, savedAt: "2026-10-20T10:00:00", lines: s.lines.length, totalBeforeTax: "3000.00" });
      s.versionNumber++; s.version++; s.lines = [...s.lines, line(2, "1")]; return route.fulfill(ok(quote(), 201));
    }
    if (path === "/quotes/7/versions/1/restore") { s.lines = [line(1, "2")]; s.version++; return route.fulfill(ok(quote())); }
    if (path.startsWith("/workspace/reviews?")) return route.fulfill(ok(s.reviews));
    if (path === "/workspace/reviews") {
      const r = { id: 81, version: 0, quoteId: (body as Record<string, unknown>).quoteId ?? null, contractId: (body as Record<string, unknown>).contractId ?? null,
        quoteVersionNumber: s.versionNumber, status: "PENDING", requestedBy: "Sara Sales", requestedAt: "2026-10-20T10:05:00", reviewedBy: null, reason: null,
        decisionStatus: "BLOCKED_BY_POLICY", requestedByMe: true, events: [{ kind: "REQUESTED", reason: null, actorName: "Sara Sales", at: "2026-10-20T10:05:00" }] };
      s.reviews = [r]; return route.fulfill(ok(r, 201));
    }
    if (path === "/workspace/reviews/81/withdraw") {
      Object.assign(s.reviews[0], { status: "WITHDRAWN", version: 1, events: [...(s.reviews[0].events as unknown[]), { kind: "WITHDRAWN", reason: null, actorName: "Sara Sales", at: "2026-10-20T10:06:00" }] });
      return route.fulfill(ok(s.reviews[0]));
    }
    if (path.startsWith("/workspace/invoice-requests?")) return route.fulfill(ok(s.requests));
    if (path === "/workspace/invoice-requests") {
      const r = { id: 91, version: 0, quoteId: 7, milestoneId: 61, milestoneTitle: "Deposit", dueDate: "2026-11-01", amountBeforeTax: "900.000", currency: "EGP",
        status: "REQUESTED", requestedBy: "Sara Sales", requestedAt: "2026-10-20T10:10:00", invoiceStatus: "BLOCKED_BY_POLICY" };
      s.requests = [r]; return route.fulfill(ok(r, 201));
    }
    if (path === "/workspace/invoice-requests/91/cancel") { Object.assign(s.requests[0], { status: "CANCELLED", version: 1 }); return route.fulfill(ok(s.requests[0])); }
    if (path.startsWith("/contracts?")) return route.fulfill(ok([{ id: 3, version: s.contractVersion, reference: "CT0003", name: "Hotel certification",
      status: options.contractStatus ?? "DRAFT", contractType: "BILLING", opportunityId: 101, accountId: 901, accountName: "Nile View Hotel", currency: "EGP",
      activationStatus: "BLOCKED_BY_POLICY", lines: [] }]));
    if (path === "/workspace/contracts/3/renewal") { s.renewed = true; return route.fulfill(ok({ opportunityId: 140, name: "Renewal: Hotel certification", contractId: 3 }, 201)); }
    if (path === "/workspace/account360/901") return route.fulfill(ok({ id: 901, name: "Nile View Hotel",
      sections: [{ key: "OPPORTUNITIES", count: 2, permitted: true }, { key: "QUOTES", count: 1, permitted: true }, { key: "CONTRACTS", count: 1, permitted: true }],
      money: [{ currency: "EGP", quotedDraft: "3000.000", bookedActive: "0", invoiceRequested: "900.000", invoiced: null, collected: null }] }));
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { requests, answers, fail };
}

test("quote workflow: versions saved and restored with the quotation version; review requested and withdrawn; decisions blocked (D-11)", async ({page}) => {
  const { requests, answers, fail } = await workflowMocks(page);
  await page.goto("/#/opportunities/101");
  await expect(page.locator(".quotes-panel .quote-head")).toContainText("SO-0007");
  await expect(page.getByText("لا توجد إصدارات محفوظة")).toBeVisible();
  answers.push(fail(409, "CONFLICT"));
  await page.getByRole("button", { name: "حفظ كإصدار" }).click();
  await expect(page.getByRole("alert")).toHaveText(/تم تعديل البيانات من مكان آخر/);
  await page.getByRole("button", { name: "حفظ كإصدار" }).click();
  await expect(page.locator(".wf-list li").first()).toContainText("1");
  await expect(page.locator(".wf-block h4").first()).toContainText("الإصدار الحالي: 2");
  await page.getByRole("button", { name: "استعادة" }).click();
  expect(requests.filter(r => r.method === "POST" && r.path.startsWith("/quotes/7/versions")).map(r => [r.path, r.body]))
    .toEqual([["/quotes/7/versions", { version: 3 }], ["/quotes/7/versions", { version: 3 }], ["/quotes/7/versions/1/restore", { version: 4 }]]);
  await page.getByRole("button", { name: "طلب مراجعة" }).first().click();
  await expect(page.locator(".wf-review .wf-status")).toHaveText("بانتظار المراجعة");
  await expect(page.getByRole("button", { name: "اعتماد", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "رفض", exact: true }).first()).toBeDisabled();
  await expect(page.locator("#wf-decision-note").first()).toContainText("D-11");
  await page.getByRole("button", { name: "سحب الطلب" }).click();
  await expect(page.locator(".wf-trail")).toContainText("سُحب الطلب");
  expect(requests.some(r => /approve|reject/.test(r.path))).toBe(false);
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("invoice requests on a confirmed order: requested once, refusals localized, issue blocked (D-06); contract renewal", async ({page}) => {
  const { requests, answers, fail } = await workflowMocks(page, { quoteStatus: "CONFIRMED", contractStatus: "ACTIVE" });
  await page.goto("/#/opportunities/101");
  answers.push(fail(409, "INVOICE_REQUEST_EXISTS"));
  await page.getByRole("button", { name: "طلب فاتورة: Deposit" }).click();
  await expect(page.getByRole("alert")).toHaveText(/توجد طلب فوترة مفتوح لهذه الدفعة/);
  await page.getByRole("button", { name: "طلب فاتورة: Deposit" }).click();
  await expect(page.locator(".wf-list")).toContainText("900.00 EGP");
  await expect(page.getByRole("button", { name: "إصدار الفاتورة" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "طلب فاتورة: Deposit" })).toHaveCount(0);
  expect(requests.filter(r => r.path === "/workspace/invoice-requests").map(r => r.body)).toEqual([{ milestoneId: 61, quoteVersion: 3 }, { milestoneId: 61, quoteVersion: 3 }]);
  await page.getByRole("button", { name: "إلغاء الطلب" }).click();
  await expect(page.locator(".wf-list")).toContainText("ملغى");
  await page.getByRole("button", { name: "فتح فرصة تجديد" }).click();
  await expect(page.getByRole("link", { name: "فتح الفرصة" })).toHaveAttribute("href", "#/opportunities/140");
  expect(requests.some(r => /issue/.test(r.path))).toBe(false);
});

test("Account 360 summary shows only readable areas and keeps money stages apart; unreadable stages show a dash", async ({page}) => {
  await workflowMocks(page);
  await page.goto("/#/accounts/901");
  await expect(page.locator(".wf-cards")).toContainText("الفرص");
  await expect(page.locator(".wf-cards li")).toHaveCount(3);
  await expect(page.locator(".wf-cards")).not.toContainText("ملف المانح");
  const row = page.locator(".wf-money tbody tr").first();
  await expect(row).toContainText("3,000.00");
  await expect(row).toContainText("900.00");
  await expect(row.locator("td").nth(4)).toHaveText("—");
  await expect(row.locator("td").nth(5)).toHaveText("—");
});

async function marketingMocks(page: Page) {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, field?: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee06", fields: field ? [{ field, code: "FORMAT", message: "x" }] : [] } }) });
  const s = {
    leadVersion: 4,
    views: [] as Record<string, unknown>[],
    consents: [] as Record<string, unknown>[],
    emailAllowed: true,
    campaigns: [] as { id: number; name: string }[],
    followUps: [
      { id: 71, version: 0, type: "CALL", subject: "Call back about ISO 9001", at: "2026-10-19T10:00:00", status: "PLANNED", overdue: true, leadId: 207, leadName: "Nour Hassan" },
      { id: 72, version: 0, type: "MEETING", subject: "Site visit", at: "2026-10-25T11:00:00", status: "PLANNED", overdue: false, leadId: 207, leadName: "Nour Hassan" },
    ],
  };
  const lead = () => ({ id: 207, version: s.leadVersion, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", converted: false,
    stageId: 1, stageKind: "OPEN", assignedToMe: true, receivedAt: "2026-10-18T09:00:00Z", businessLineCode: "ISO9001" });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(url => /\/ws\/ioeti\/(marketing\/|leads\/207$)/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, path, body });
    const refusal = method === "POST" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path === "/leads/207") return route.fulfill(ok(lead()));
    if (path.startsWith("/marketing/leads?")) return route.fulfill(ok([lead(), { id: 206, name: "Mona Saber", organization: "Delta Foods", stage: "Qualified" }]));
    if (path === "/marketing/sources") return route.fulfill(ok([{ id: 11, name: "Exhibition" }, { id: 12, name: "Website" }]));
    if (path === "/marketing/campaigns") return route.fulfill(ok([{ id: 31, name: "Hotels autumn" }]));
    if (path === "/marketing/saved-views" && method === "GET") return route.fulfill(ok(s.views));
    if (path === "/marketing/saved-views") {
      const v = { id: 41, name: body!.name, searchText: body!.searchText, stageId: body!.stageId, sourceId: body!.sourceId, businessLineCode: body!.businessLineCode, onlyMine: body!.onlyMine };
      s.views = [v]; return route.fulfill(ok(v, 201));
    }
    if (path === "/marketing/saved-views/41/delete") { const v = s.views[0]; s.views = []; return route.fulfill(ok(v)); }
    if (path === "/marketing/leads") return route.fulfill(ok({ id: 208, version: 0, name: "احمد عبد الله", organization: "موسسه الهدي", stage: "New" }, 201));
    if (path === "/marketing/leads/duplicates") return route.fulfill(ok([lead()]));
    if (path === "/marketing/leads/207/consents" && method === "GET") return route.fulfill(ok({
      channels: [{ channel: "EMAIL", allowed: s.emailAllowed }, { channel: "CALL", allowed: true }], history: s.consents }));
    if (path === "/marketing/leads/207/consents") {
      s.emailAllowed = body!.allowed as boolean; s.leadVersion++;
      const c = { id: 50 + s.consents.length, channel: body!.channel, allowed: body!.allowed, method: body!.method, evidenceReference: body!.evidenceReference,
        recordedBy: "Sara Sales", at: "2026-10-20T10:0" + s.consents.length + ":00" };
      s.consents = [c, ...s.consents]; return route.fulfill(ok(c, 201));
    }
    if (path === "/marketing/leads/207/attribution") return route.fulfill(ok({ sourceId: 11, sourceName: "Exhibition", campaigns: s.campaigns }));
    if (path === "/marketing/leads/207/campaigns") { s.campaigns = [{ id: 31, name: "Hotels autumn" }]; s.leadVersion++;
      return route.fulfill(ok({ sourceId: 11, sourceName: "Exhibition", campaigns: s.campaigns })); }
    if (path === "/marketing/leads/207/timeline") return route.fulfill(ok([
      ...s.consents.map(c => ({ at: c.at, kind: c.allowed ? "CONSENT_GIVEN" : "OPTED_OUT", label: c.channel, status: null, actorName: "Sara Sales", eventId: null })),
      { at: "2026-10-19T10:00:00", kind: "ACTIVITY_CALL", label: "Call back about ISO 9001", status: "PLANNED", actorName: "Sara Sales", eventId: 71 }]));
    if (path === "/marketing/leads/207/follow-ups") { s.leadVersion++;
      return route.fulfill(ok({ id: 73, version: 0, type: body!.type, subject: body!.subject, at: body!.at, status: "PLANNED", overdue: false, leadId: 207, leadName: "Nour Hassan" }, 201)); }
    if (path === "/marketing/follow-ups/71/done") { s.followUps = s.followUps.filter(f => f.id !== 71); return route.fulfill(ok({ id: 71, version: 1, status: "DONE" })); }
    if (path.startsWith("/marketing/follow-ups")) return route.fulfill(ok(url.searchParams.get("overdue") ? s.followUps.filter(f => f.overdue) : s.followUps));
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { requests, answers, fail };
}

test("lead intake: invalid e-mail localized; possible duplicates reviewed before recording; confirmed intake opens the new lead", async ({page}) => {
  const { requests, answers, fail } = await marketingMocks(page);
  await page.goto("/#/leads");
  await page.getByRole("button", { name: "عميل محتمل جديد" }).click();
  const form = page.locator(".mk-intake");
  await form.getByLabel("الاسم أو اسم العائلة").fill("عبد الله");
  await form.getByLabel("الاسم الأول").fill("احمد");
  await form.getByLabel("الجهة").fill("موسسه الهدي");
  await form.getByLabel("البريد الإلكتروني").fill("ahmed@example");
  await form.getByLabel("المصدر").selectOption("11");
  await form.getByLabel("الحملة").selectOption("31");
  answers.push(fail(422, "VALIDATION_FAILED", "email"));
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/أدخل بريدًا إلكترونيًا صحيحًا/);
  await form.getByLabel("البريد الإلكتروني").fill("ahmed@example.test");
  answers.push(fail(409, "POSSIBLE_DUPLICATE"));
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  const review = page.getByRole("region", { name: "عملاء محتملون مشابهون ضمن نطاقك" });
  await expect(review).toContainText("Nour Hassan");
  await expect(review.getByRole("link", { name: "فتح" })).toHaveAttribute("href", "#/leads/207");
  await expect(page.getByRole("button", { name: "تسجيل", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "ليس تكرارًا، سجّل" }).click();
  await expect(page).toHaveURL(/#\/leads\/208$/);
  const intakes = requests.filter(r => r.method === "POST" && r.path === "/marketing/leads").map(r => r.body as Record<string, unknown>);
  expect(intakes.map(b => b.confirmNotDuplicate)).toEqual([false, false, true]);
  expect(intakes[2]).toMatchObject({ firstName: "احمد", name: "عبد الله", organization: "موسسه الهدي", email: "ahmed@example.test", sourceId: 11, campaignId: 31 });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("lead list: server-side filters and saved views owned by the user", async ({page}) => {
  const { requests } = await marketingMocks(page);
  await page.goto("/#/leads");
  await expect(page.getByText("Mona Saber")).toBeVisible();
  await page.locator(".mk-filters").getByLabel("المصدر").selectOption("12");
  await page.locator(".mk-filters").getByLabel("المكلّفون بي فقط").check();
  await expect.poll(() => requests.some(r => r.path.includes("sourceId=12") && r.path.includes("mine=true"))).toBe(true);
  await page.getByRole("button", { name: "حفظ الفلتر" }).click();
  await page.getByPlaceholder("اسم العرض").fill("Website mine");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByLabel("العروض المحفوظة")).toHaveValue("41");
  expect(requests.find(r => r.method === "POST" && r.path === "/marketing/saved-views")?.body)
    .toEqual({ name: "Website mine", searchText: null, stageId: null, sourceId: 12, businessLineCode: null, onlyMine: true });
  await page.locator(".mk-filters").getByLabel("المصدر").selectOption("");
  await page.getByLabel("العروض المحفوظة").selectOption("41");
  await expect(page.locator(".mk-filters").getByLabel("المصدر")).toHaveValue("12");
  await page.getByRole("button", { name: "حذف العرض" }).click();
  await expect(page.getByLabel("العروض المحفوظة").locator("option")).toHaveCount(1);
});

test("lead page: consent needs evidence, opt-out does not; attribution, follow-up and timeline use the lead version; queue marks done", async ({page}) => {
  const { requests } = await marketingMocks(page);
  await page.goto("/#/leads/207");
  const panel = page.locator(".mk-engagement");
  await expect(panel.locator(".mk-channels")).toContainText("مسموح");
  await expect(panel.getByRole("button", { name: "تسجيل موافقة" })).toBeDisabled();
  await panel.getByLabel("الطريقة").selectOption("EMAIL");
  await panel.getByRole("button", { name: "تسجيل رفض" }).click();
  await expect(panel.locator(".mk-channels li").first()).toContainText("رفض التواصل");
  await panel.getByLabel("الطريقة").selectOption("WRITTEN");
  await panel.getByLabel("مرجع الإثبات").fill("Signed form 12");
  await panel.getByRole("button", { name: "تسجيل موافقة" }).click();
  await expect(panel.locator(".wf-trail").first()).toContainText("Signed form 12");
  expect(requests.filter(r => r.method === "POST" && r.path.endsWith("/consents")).map(r => r.body)).toEqual([
    { version: 4, channel: "EMAIL", allowed: false, method: "EMAIL", evidenceReference: null },
    { version: 5, channel: "EMAIL", allowed: true, method: "WRITTEN", evidenceReference: "Signed form 12" }]);
  await expect(panel).toContainText("Exhibition");
  await panel.getByLabel("الحملة").selectOption("31");
  await panel.getByRole("button", { name: "ربط بحملة" }).click();
  await expect(panel.locator(".mk-tags")).toContainText("Hotels autumn");
  await panel.getByLabel("الموضوع").fill("Send the audit plan");
  await panel.getByLabel("الموعد").fill("2026-11-02T10:30");
  await panel.getByRole("button", { name: "تخطيط متابعة" }).click();
  expect(requests.find(r => r.method === "POST" && r.path.endsWith("/follow-ups"))?.body)
    .toEqual({ version: 7, type: "CALL", subject: "Send the audit plan", at: "2026-11-02T10:30" });
  await expect(panel.locator(".mk-timeline")).toContainText("مكالمة");
  await expect(panel.locator(".mk-timeline")).toContainText("موافقة");
  await expect(panel).toContainText("لا يُرسل منها أي بريد");
  await page.goto("/#/leads");
  await page.getByRole("button", { name: "المتابعات" }).click();
  await page.getByLabel("المتأخرة فقط").check();
  await expect(page.locator(".mk-queue .wf-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "تم", exact: true }).click();
  await expect(page.getByText("لا توجد متابعات مخططة")).toBeVisible();
  await expect(page.locator(".mk-queue")).toContainText("D-12");
  expect(requests.some(r => r.path.includes("/route"))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/leads/207");
  await expect(page.locator(".mk-engagement")).toBeVisible();
  // no horizontal page scroll; on failure, name what sticks out of the main area
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] :
    [...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1)
      .map(e => `${e.tagName}.${String(e.className)}`).slice(0, 5))).toEqual([]);
});

async function contentMocks(page: Page, options: { editor?: boolean } = {}) {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, fieldCode?: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee07", fields: fieldCode ? [{ field: "content", code: fieldCode, message: "x" }] : [] } }) });
  const rev = (n: number, fileName: string) => ({ number: n, fileName, contentType: "application/pdf", sizeBytes: 2048, sha256: "a".repeat(64),
    changeSummary: n > 1 ? "Scope updated" : null, uploadedBy: "Sara Sales", uploadedAt: `2026-10-2${n}T09:00:00` });
  const s = {
    docs: [{ id: 5, version: 1, title: "Technical proposal", kind: "PROPOSAL", subject: "LEAD", subjectId: 207, language: "BILINGUAL", ownerName: "Sara Sales",
      currentRevision: 2, archived: false, revisions: [rev(2, "Proposal v2.pdf"), rev(1, "Proposal v1.pdf")] }] as Record<string, unknown>[],
    article: { id: 9, version: 3, status: "PUBLISHED", categoryId: 1, businessLineCode: "ISO9001", canEdit: !!options.editor,
      published: { revision: 1, titleEn: "Audit day preparation", titleAr: "التحضير ليوم المراجعة", bodyEn: "Bring the quality manual.\n<b>not bold</b>",
        bodyAr: "إحضار دليل الجودة.", publishedBy: "Mona Editor", publishedAt: "2026-10-19T08:00:00" },
      working: options.editor ? { titleEn: "Audit day preparation", titleAr: "التحضير ليوم المراجعة", bodyEn: "Bring the quality manual.", bodyAr: "إحضار دليل الجودة.", unpublishedChanges: false } : null,
      revisions: options.editor ? [{ number: 1, publishedBy: "Mona Editor", publishedAt: "2026-10-19T08:00:00" }] : [] } as Record<string, unknown>,
  };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(url => /\/ws\/ioeti\/(content\/|leads\/207$)/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, path, body });
    const refusal = method === "POST" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path === "/leads/207") return route.fulfill(ok({ id: 207, version: 4, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", converted: false, stageId: 1, stageKind: "OPEN" }));
    if (path.startsWith("/content/documents?")) return route.fulfill(ok(s.docs));
    if (path === "/content/documents") {
      const d = { id: 6, version: 0, title: body!.title, kind: body!.kind, subject: body!.subject, subjectId: body!.subjectId, language: body!.language, ownerName: "Sara Sales",
        currentRevision: 1, archived: false, revisions: [rev(1, body!.fileName as string)] };
      s.docs = [d, ...s.docs]; return route.fulfill(ok(d, 201));
    }
    if (path === "/content/documents/5/revisions") { Object.assign(s.docs.find(d => d.id === 5)!, { version: 2, currentRevision: 3 }); return route.fulfill(ok(s.docs.find(d => d.id === 5), 201)); }
    if (path === "/content/documents/5/archive") { s.docs = s.docs.filter(d => d.id !== 5); return route.fulfill(ok({ id: 5, archived: true })); }
    if (path === "/content/kb/categories") return route.fulfill(ok([{ id: 1, code: "PROC", nameEn: "Procedures", nameAr: "إجراءات" }]));
    if (path === "/content/kb/drafts") return options.editor ? route.fulfill(ok([{ id: 9, status: "PUBLISHED", titleEn: "Audit day preparation", titleAr: "التحضير ليوم المراجعة",
      categoryId: 1, businessLineCode: "ISO9001", revision: 1, publishedAt: "2026-10-19T08:00:00" }])) : route.fulfill(fail(403, "FORBIDDEN"));
    if (path.startsWith("/content/kb/articles?") || (path === "/content/kb/articles" && method === "GET")) return route.fulfill(ok([{ id: 9, status: "PUBLISHED", titleEn: "Audit day preparation", titleAr: "التحضير ليوم المراجعة",
      categoryId: 1, businessLineCode: "ISO9001", revision: 1, publishedAt: "2026-10-19T08:00:00" }]));
    if (path === "/content/kb/articles/9" && method === "GET") return route.fulfill(ok(s.article));
    if (path === "/content/kb/articles") return route.fulfill(ok({ ...s.article, id: 10, version: 0, status: "DRAFT", published: null,
      working: { titleEn: body!.titleEn, titleAr: body!.titleAr, bodyEn: body!.bodyEn, bodyAr: body!.bodyAr, unpublishedChanges: true }, revisions: [], canEdit: true }, 201));
    if (path === "/content/kb/articles/10" && method === "GET") return route.fulfill(ok({ ...s.article, id: 10, version: 0, status: "DRAFT", published: null, canEdit: true,
      working: { titleEn: "Visit checklist", titleAr: "قائمة الزيارة", bodyEn: "Check the scope.", bodyAr: "راجع النطاق.", unpublishedChanges: true }, revisions: [] }));
    if (path === "/content/kb/articles/10/publish") return route.fulfill(ok({ ...s.article, id: 10, version: 1, canEdit: true,
      published: { revision: 1, titleEn: "Visit checklist", titleAr: "قائمة الزيارة", bodyEn: "Check the scope.", bodyAr: "راجع النطاق.", publishedBy: "Mona Editor", publishedAt: "2026-10-20T12:00:00" } }));
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { requests, answers, fail };
}

test("documents on a lead: revisions listed with download links; upload checked and sent as base64 with the record; revision and archive use the document version", async ({page}) => {
  const { requests, answers, fail } = await contentMocks(page);
  await page.goto("/#/leads/207");
  const panel = page.locator(".ct-documents");
  await expect(panel).toContainText("Technical proposal");
  await expect(panel.locator(".ct-current a")).toHaveAttribute("href", "/axelor-erp/ws/ioeti/content/documents/5/revisions/2/content");
  await panel.getByText(/الإصدارات السابقة/).click();
  await expect(panel.locator(".wf-trail")).toContainText("Proposal v1.pdf");
  await panel.getByRole("button", { name: "إضافة مستند" }).click();
  await panel.getByLabel("العنوان").fill("Signed scope");
  await panel.getByLabel("النوع").selectOption("CONTRACT");
  await panel.getByLabel("الملف").setInputFiles({ name: "scope.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 scope") });
  answers.push(fail(422, "VALIDATION_FAILED", "TYPE_MISMATCH"));
  await panel.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("alert")).toHaveText(/محتوى الملف لا يطابق امتداده/);
  await panel.getByLabel("الملف").setInputFiles({ name: "scope.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 scope") });
  await panel.getByRole("button", { name: "حفظ" }).click();
  await expect(panel.locator(".ct-list > li").first()).toContainText("Signed scope");
  const filed = requests.filter(r => r.method === "POST" && r.path === "/content/documents").map(r => r.body as Record<string, unknown>);
  expect(filed[1]).toMatchObject({ subject: "LEAD", subjectId: 207, title: "Signed scope", kind: "CONTRACT", language: "BILINGUAL", fileName: "scope.pdf",
    contentBase64: Buffer.from("%PDF-1.4 scope").toString("base64") });
  const item = panel.locator(".ct-list > li").filter({ hasText: "Technical proposal" });
  await item.getByRole("button", { name: "رفع إصدار جديد" }).click();
  await item.getByLabel("الملف").setInputFiles({ name: "v3.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 v3") });
  await item.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => requests.find(r => r.path === "/content/documents/5/revisions")?.body).toMatchObject({ version: 1, fileName: "v3.pdf" });
  await panel.locator(".ct-list > li").filter({ hasText: "Technical proposal" }).getByRole("button", { name: "أرشفة" }).click();
  await expect(panel).not.toContainText("Technical proposal");
  await expect.poll(() => requests.find(r => r.path === "/content/documents/5/archive")?.body).toEqual({ version: 2 });
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("knowledge base: readers search and read the published revision as plain text in both languages; no editing for readers", async ({page}) => {
  const { requests } = await contentMocks(page);
  await page.goto("/#/knowledge");
  await expect(page.getByRole("heading", { name: "قاعدة المعرفة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "التحرير" })).toHaveCount(0);
  await page.getByPlaceholder("ابحث في المقالات المنشورة...").fill("المراجعه");
  await expect.poll(() => requests.some(r => r.path.startsWith("/content/kb/articles?") && new URLSearchParams(r.path.split("?")[1]).get("q") === "المراجعه")).toBe(true);
  expect(requests.some(r => r.path.endsWith("?"))).toBe(false);
  await page.getByRole("button", { name: "فتح" }).click();
  await expect(page.getByRole("heading", { name: "التحضير ليوم المراجعة" })).toBeVisible();
  await expect(page.locator(".ct-body[lang=ar]")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".ct-body[lang=en]")).toContainText("<b>not bold</b>");
  await expect(page.locator(".ct-body b")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "نشر" })).toHaveCount(0);
});

test("knowledge base: editors start, save and publish an article; unchanged publish is explained; mobile without horizontal scroll", async ({page}) => {
  const { requests, answers, fail } = await contentMocks(page, { editor: true });
  await page.goto("/#/knowledge");
  await page.getByRole("button", { name: "التحرير" }).click();
  await expect(page.locator(".ct-articles")).toContainText("التحضير ليوم المراجعة");
  await page.getByRole("button", { name: "مقال جديد" }).click();
  await page.getByLabel("العنوان بالعربية").fill("قائمة الزيارة");
  await page.getByLabel("العنوان بالإنجليزية").fill("Visit checklist");
  await page.getByLabel("النص بالعربية").fill("راجع النطاق.");
  await page.getByLabel("النص بالإنجليزية").fill("Check the scope.");
  await page.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(page.locator(".ct-article .wf-status").first()).toHaveText("مسودة");
  expect(requests.find(r => r.method === "POST" && r.path === "/content/kb/articles")?.body)
    .toEqual({ titleAr: "قائمة الزيارة", titleEn: "Visit checklist", bodyAr: "راجع النطاق.", bodyEn: "Check the scope." });
  answers.push(fail(422, "UNCHANGED"));
  await page.getByRole("button", { name: "نشر" }).click();
  await expect(page.getByRole("alert")).toHaveText(/لا يوجد تغيير منذ آخر نسخة منشورة/);
  await page.getByRole("button", { name: "نشر" }).click();
  await expect(page.locator(".ct-body[lang=ar]")).toContainText("راجع النطاق.");
  expect(requests.filter(r => r.path === "/content/kb/articles/10/publish").map(r => r.body)).toEqual([{ version: 0 }, { version: 0 }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ct-article")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] :
    [...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).map(e => `${e.tagName}.${String(e.className)}`).slice(0, 5))).toEqual([]);
});

async function insightsMocks(page: Page, options: { admin?: boolean } = {}) {
  await intercept(page);
  const ok = (object: unknown, code = 200) => ({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
  const fail = (status: number, code: string, fieldCode?: string) => ({ status, contentType: "application/json", body: JSON.stringify({
    codeStatus: status, messageStatus: "x", error: { code, message: "raw server text", correlationId: "c0ffee08", fields: fieldCode ? [{ field: "name", code: fieldCode, message: "x" }] : [] } }) });
  const s = {
    notices: [
      { id: 1, kind: "MENTION", subject: "LEAD", subjectId: 207, title: "Can you call them?", actorName: "Sara Sales", read: false, at: "2026-10-20T09:00:00" },
      { id: 2, kind: "REVIEW_CHANGES_REQUESTED", subject: "OPPORTUNITY", subjectId: 101, title: "Quotation SO-0007", actorName: "Mona Manager", read: false, at: "2026-10-20T08:00:00" },
    ],
    drafts: [] as Record<string, unknown>[],
    sources: [{ id: 11, name: "Exhibition" }],
  };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const answers: ReturnType<typeof fail>[] = [];
  await page.route(url => /\/ws\/ioeti\/(automation\/|reports\/|marketing\/sources|leads\/207$)/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/.*\/ws\/ioeti/, "") + url.search;
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, path, body });
    const refusal = method === "POST" ? answers.shift() : undefined;
    if (refusal) return route.fulfill(refusal);
    if (path === "/leads/207") return route.fulfill(ok({ id: 207, version: 4, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", converted: false, stageId: 1, stageKind: "OPEN" }));
    if (path === "/automation/inbox/count") return route.fulfill(ok({ unread: s.notices.filter(n => !n.read).length }));
    if (path.startsWith("/automation/inbox?") || path === "/automation/inbox") return route.fulfill(ok(url.searchParams.get("unread") ? s.notices.filter(n => !n.read) : s.notices));
    if (/\/automation\/inbox\/\d+\/read$/.test(path)) { const n = s.notices.find(x => x.id === Number(path.split("/")[3]))!; n.read = true; return route.fulfill(ok(n)); }
    if (path === "/automation/inbox/read-all") { s.notices.forEach(n => n.read = true); return route.fulfill(ok({ marked: 1 })); }
    if (path.startsWith("/automation/people?")) return route.fulfill(ok([{ id: 31, name: "Omar Ops" }]));
    if (path === "/automation/mentions") return route.fulfill(ok({ recipientId: 31 }, 201));
    if (path.startsWith("/automation/outbox?")) return route.fulfill(ok(s.drafts));
    if (path === "/automation/outbox") { const d = { id: 41, version: 0, leadId: 207, channel: "EMAIL", subjectLine: body!.subjectLine, body: body!.body, status: "DRAFT",
      authorName: "Sara Sales", createdAt: "2026-10-20T10:00:00", sendStatus: "BLOCKED_BY_POLICY" }; s.drafts = [d]; return route.fulfill(ok(d, 201)); }
    if (path === "/automation/outbox/41/cancel") { s.drafts = [{ ...s.drafts[0], status: "CANCELLED", version: 1 }]; return route.fulfill(ok(s.drafts[0])); }
    if (path.startsWith("/reports/sales")) return route.fulfill(ok({ from: null, to: null, businessLineCode: null,
      pipeline: [{ businessLineCode: "ISO9001", stage: "Proposal", open: true, count: 2, amounts: [{ currency: "EGP", amount: "1000.00" }, { currency: "USD", amount: "500.00" }] }],
      leads: { total: 4, open: 2, converted: 1, lost: 1, bySource: [{ source: "=HYPERLINK(\"x\")", total: 4, open: 2, converted: 1, lost: 1 }] },
      campaigns: null, followUps: { planned: 3, overdue: 1, doneLast30Days: 5 } }));
    if (path.startsWith("/reports/areas")) return route.fulfill(ok({ from: null, to: null, areas: [{ key: "HANDOVERS", count: 2 }] }));
    if (path === "/reports/system") return options.admin ? route.fulfill(ok({ modules: ["ioeti-core", "ioeti-reports"],
      migrations: [{ version: 15, name: "ioeti_automation", appliedOn: "2026-10-20T12:00:00" }],
      policies: [{ id: "D-10", title: "External exposure", status: "OPEN" }] })) : route.fulfill(fail(403, "FORBIDDEN"));
    if (path === "/marketing/sources" && method === "GET") return route.fulfill(ok(s.sources));
    if (path === "/marketing/sources") { const n = { id: 12, name: body!.name as string }; s.sources = [...s.sources, n]; return route.fulfill(ok(n, 201)); }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { requests, answers, fail };
}

test("inbox: unread badge in the navigation; notices link to their record; read one and read all update the badge", async ({page}) => {
  const { requests } = await insightsMocks(page);
  await page.goto("/");
  const nav = page.locator("button.nav-item").filter({ hasText: "الإشعارات" });
  await expect(nav.locator(".in-badge")).toHaveText("2");
  await nav.click();
  await expect(page.locator(".in-list li").first()).toContainText("Can you call them?");
  await expect(page.locator(".in-list li").first().getByRole("link", { name: "فتح" })).toHaveAttribute("href", "#/leads/207");
  await expect(page.locator(".in-list li").nth(1).getByRole("link", { name: "فتح" })).toHaveAttribute("href", "#/opportunities/101");
  await page.locator(".in-list li").first().getByRole("button", { name: "تعليم كمقروء" }).click();
  await expect(nav.locator(".in-badge")).toHaveText("1");
  await page.getByRole("button", { name: "تعليم الكل كمقروء" }).click();
  await expect(nav.locator(".in-badge")).toHaveCount(0);
  expect(requests.filter(r => r.method === "POST").map(r => r.path)).toEqual(["/automation/inbox/1/read", "/automation/inbox/read-all"]);
});

test("lead page: outbox drafts are kept but sending is disabled (D-10); an opt-out refusal is explained; mentions pick a colleague", async ({page}) => {
  const { requests, answers, fail } = await insightsMocks(page);
  await page.goto("/#/leads/207");
  const outbox = page.locator(".in-outbox");
  await outbox.getByLabel("عنوان الرسالة").fill("Audit dates");
  await outbox.getByLabel("نص الرسالة").fill("Dear Nour,");
  answers.push(fail(422, "OPTED_OUT"));
  await outbox.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(outbox.getByRole("alert")).toHaveText(/العميل رفض التواصل بالبريد/);
  await outbox.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(outbox.locator(".wf-list")).toContainText("Audit dates");
  await expect(outbox.getByRole("button", { name: "إرسال", exact: true })).toBeDisabled();
  await expect(outbox).toContainText("D-10");
  await outbox.getByRole("button", { name: "إلغاء المسودة" }).click();
  await expect(outbox.locator(".wf-list")).toContainText("ملغاة");
  const mention = page.locator(".in-mention");
  await mention.getByLabel("الزميل").first().fill("Om");
  await mention.locator("select").selectOption("31");
  await mention.getByLabel("الرسالة").fill("Please call them");
  await mention.getByRole("button", { name: "إرسال داخلي" }).click();
  await expect(mention.getByRole("status")).toHaveText("تم إرسال الإشارة.");
  expect(requests.find(r => r.path === "/automation/mentions")?.body).toEqual({ recipientId: 31, subject: "LEAD", subjectId: 207, message: "Please call them" });
  expect(requests.some(r => r.path.endsWith("/send"))).toBe(false);
});

test("reports: values stay per currency; hidden sections are absent; CSV export neutralizes formulas", async ({page}) => {
  await insightsMocks(page);
  await page.goto("/#/reports");
  const pipeline = page.locator(".rp-card").filter({ hasText: "خط المبيعات حسب المرحلة" });
  await expect(pipeline.locator("td[dir=ltr]")).toContainText("1,000.00 EGP");
  await expect(pipeline.locator("td[dir=ltr]")).toContainText("500.00 USD");
  await expect(pipeline).not.toContainText("1,500");
  await expect(page.getByRole("heading", { name: "الحملات" })).toHaveCount(0);
  await expect(page.locator(".rp-card").filter({ hasText: "العملاء المحتملون حسب المصدر" })).toContainText("25%");
  await expect(page.locator(".rp-card").filter({ hasText: "السجلات في كل قسم" })).toContainText("طلبات التسليم");
  const [file] = await Promise.all([page.waitForEvent("download"),
    page.locator(".rp-card").filter({ hasText: "العملاء المحتملون حسب المصدر" }).getByRole("button", { name: "تصدير CSV" }).click()]);
  const csv = await (await import("node:fs/promises")).readFile((await file.path())!, "utf-8");
  expect(csv).toContain(`"'=HYPERLINK(""x"")","4","2","1","1"`);
});

test("settings: preferences and lead sources for everyone; the system page only for administrators", async ({page}) => {
  const { requests } = await insightsMocks(page);
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "الإعدادات", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "حالة النظام" })).toHaveCount(0);
  await page.getByPlaceholder("الاسم").fill("Website");
  await page.getByRole("button", { name: "إضافة مصدر" }).click();
  await expect(page.locator(".mk-tags")).toContainText("Website");
  expect(requests.find(r => r.method === "POST" && r.path === "/marketing/sources")?.body).toEqual({ name: "Website" });
  await page.locator(".st-page").getByLabel("اللغة").selectOption("en");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

test("settings: administrators see installed modules, applied migrations and open policy decisions", async ({page}) => {
  await insightsMocks(page, { admin: true });
  await page.goto("/#/settings");
  const system = page.locator(".rp-card").filter({ hasText: "حالة النظام" });
  await expect(system).toContainText("ioeti-reports");
  await expect(system).toContainText("V015");
  await expect(system).toContainText("D-10");
  await expect(system).toContainText("مفتوح");
});

test("mobile gate: every live-mode page fits a 390 px screen without horizontal scrolling", async ({page}) => {
  await insightsMocks(page, { admin: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = ["#/", "#/leads", "#/leads/207", "#/accounts", "#/opportunities", "#/operations", "#/knowledge", "#/reports", "#/inbox", "#/settings",
    "#/training", "#/certification", "#/recruitment", "#/fundraising", "#/businessLines", "#/capabilities"];
  const overflowing: Record<string, string[]> = {};
  for (const route of routes) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] :
      [`document ${document.documentElement.scrollWidth}px`, ...[...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1)
        .map(e => `${e.tagName}.${String(e.className)}`).slice(0, 3)]);
    if (wide.length) overflowing[route] = wide;
  }
  expect(overflowing).toEqual({});
});

test("global notices: failed background reads stay silent; a refused change is announced once", async ({page}) => {
  const { answers, fail } = await insightsMocks(page);
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "الإعدادات", level: 1 })).toBeVisible();
  // the administrators' system page answers 403 to this user: an optional section, not an error
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "إغلاق التنبيه" })).toHaveCount(0);
  answers.push(fail(422, "VALIDATION_FAILED", "DUPLICATE"));
  await page.getByPlaceholder("الاسم").fill("Exhibition");
  await page.getByRole("button", { name: "إضافة مصدر" }).click();
  await expect(page.getByRole("alert")).toHaveText(/هذا المصدر موجود/);
  await expect(page.getByRole("button", { name: "إغلاق التنبيه" })).toHaveCount(1);
});

test("mobile gate: record pages with their data loaded fit a 390 px screen", async ({page}) => {
  test.setTimeout(120_000);
  const pages: [string, (p: Page) => Promise<unknown>, string][] = [
    ["account 360", p => workflowMocks(p), "#/accounts/901"],
    ["opportunity with quotation, milestones and contract", p => workflowMocks(p), "#/opportunities/101"],
    ["lead with consent, outbox and timeline", p => marketingMocks(p), "#/leads/207"],
    ["handover review", p => operationsMocks(p, { reviewer: true }), "#/operations"],
    ["recruitment", p => recruitmentMocks(p, { mine: true }), "#/recruitment"],
    ["fundraising", p => fundraisingMocks(p, { mine: true }), "#/fundraising"],
    ["certification", p => certificationMocks(p, { managedByMe: true }), "#/certification"],
  ];
  const overflowing: Record<string, string[]> = {};
  for (const [name, mock, route] of pages) {
    const context = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } });
    const p = await context.newPage();
    await mock(p);
    await p.goto("/" + route);
    await p.waitForLoadState("networkidle");
    // any document overflow fails; the named elements are the likely cause (outside scroll containers and the drawer)
    const wide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] :
      [`document ${document.documentElement.scrollWidth}px`, ...[...document.querySelectorAll("main *")]
        .filter(e => !e.parentElement?.closest(".rp-scroll,.table-scroll") && (e.getBoundingClientRect().right > window.innerWidth + 1 || e.getBoundingClientRect().left < -1))
        .map(e => `${e.tagName}.${String(e.className).split(" ")[0]}`).filter((v, i, all) => all.indexOf(v) === i).slice(0, 6)]);
    if (wide.length) overflowing[name] = wide;
    await context.close();
  }
  expect(overflowing).toEqual({});
});


test("live record pages carry no placeholder sections; a converted lead links to its account and opportunity", async ({page}) => {
  const placeholders = /لم تُربط|ستظهر|سترتبط|Event API|not connected|will (appear|link|connect)|لم نوصل|بمصدر حقيقي بعد/;
  await workflowMocks(page);
  for (const route of ["#/accounts/901", "#/opportunities/101"]) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(placeholders);
    await expect(page.locator(".record-flow-card")).toHaveCount(0);
  }
  await page.route(url => url.pathname.endsWith("/ws/ioeti/leads/208"), route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ codeStatus: 200, messageStatus: "ok", object: { id: 208, version: 6, name: "Omar Fathy", organization: "Delta Foods", stage: "Converted",
      converted: true, accountId: 902, opportunityId: 140, stageKind: "CONVERTED" } }) }));
  await page.goto("/#/leads/208");
  await expect(page.locator(".record-related")).toContainText("تم التحويل");
  await expect(page.getByRole("link", { name: "فتح الحساب" })).toHaveAttribute("href", "#/accounts/902");
  await expect(page.getByRole("link", { name: "فتح الفرصة" })).toHaveAttribute("href", "#/opportunities/140");
  await expect(page.locator("main")).not.toContainText(placeholders);
});
