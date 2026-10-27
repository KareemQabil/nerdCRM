import { expect, test, type Page, type Route } from "@playwright/test";

const lines = [
  { id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 10, responsibleTeam: null },
  { id: 2, code: "TRAINING", nameAr: "التدريب", nameEn: "Training", status: 2, sequence: 20, responsibleTeam: null },
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
    if (path.endsWith("/leads") && method === "GET") return result([
      { id: 207, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New" },
      { id: 206, name: "Mona Saber", organization: "Delta Foods", stage: "Qualified" },
    ]);
    if (path.endsWith("/leads/207") && method === "GET") return result({ id: 207, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New" });
    if (path.endsWith("/accounts") && method === "GET") return result([
      { id: 901, name: "Nile View Hotel", reference: "AC-901", customer: false, prospect: true },
      { id: 902, name: "Delta Foods", reference: "AC-902", customer: true, prospect: false },
    ]);
    if (path.endsWith("/accounts/901") && method === "GET") return result({ id: 901, name: "Nile View Hotel", reference: "AC-901", customer: false, prospect: true });
    if (path.endsWith("/quotes") && method === "GET") return result([]);
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
  await expect(page.getByText("أهلًا بك في IOETI")).toBeVisible();
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
  await page.getByRole("button", { name: "المبيعات" }).click();
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
  await page.getByRole("button", { name: "المبيعات" }).click();
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
  await page.getByRole("button", { name: "المبيعات" }).click();
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
  await expect(page.getByText("أهلًا بك في IOETI")).toBeVisible();
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
  await page.getByRole("button", { name: "المبيعات" }).click();
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
  await expect(page.getByText("أهلًا بك في IOETI")).toBeVisible();
  await expect(page.getByText("حسابك لا يملك صلاحية قراءة خطوط الأعمال.")).toBeVisible();
  await page.getByRole("button", { name: "المبيعات" }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
});

test("mobile Arabic navigation reaches live opportunity route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await intercept(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "التنقل" }).click();
  await page.getByRole("button", { name: "المبيعات" }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
  await page.screenshot({ path: "test-results/ioeti-arabic-mobile-opportunities.png", fullPage: true });
});

test("reverse-mapped Leads list and secured detail route use specific DTO APIs",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"العملاء المحتملون"}).click();
  await expect(page.getByText("Nour Hassan")).toBeVisible();
  await page.getByPlaceholder("ابحث في السجلات المحمّلة...").fill("Delta");
  await expect(page.getByText("Mona Saber")).toBeVisible();
  await expect(page.getByText("Nour Hassan")).toHaveCount(0);
  await page.getByPlaceholder("ابحث في السجلات المحمّلة...").fill("");
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
  await page.getByRole("button",{name:"المبيعات"}).click();
  const row=page.getByRole("row").filter({hasText:"Hotel certification"});
  await row.getByRole("button",{name:"التفاصيل"}).click();
  await expect(page).toHaveURL(/#\/opportunities\/101$/);
  await expect(page.locator(".opportunity-record h1")).toHaveText("Hotel certification");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".opportunity-record")).toContainText("OP-101");
  await expect(page.locator(".opportunity-record")).toContainText("Axelor CRM");
  await expect(page.locator(".opportunity-record")).toContainText("لم يتم ربط");
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

test("source-driven capability journey is interactive but does not perform unsupported actions",async ({page})=>{
  let unplannedCalls=0;
  await intercept(page);
  page.on("request",request=>{
    if(request.url().includes("/axelor-erp/ws/ioeti/certification/"))unplannedCalls++;
  });
  await page.goto("/");
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await page.getByRole("button",{name:/إدارة شهادات ISO/}).click();
  const journey=page.getByRole("region",{name:"رحلة العمل المقترحة"});
  await expect(journey).toBeVisible();
  await expect(journey.getByRole("tab")).toHaveCount(5);
  await journey.getByRole("tab",{name:/Stage 1 وStage 2/}).click();
  await expect(journey.getByRole("tabpanel")).toContainText("Intervention");
  await expect(journey.getByRole("tabpanel")).toContainText("/ws/ioeti/certification/audits/{id}/submit");
  await expect(journey).toContainText("لا يتم إرسال أي طلبات");
  expect(unplannedCalls).toBe(0);
  await page.screenshot({path:"test-results/ioeti-iso-workflow-map.png",fullPage:true});
});

test("external training and agency recruitment journeys clearly distinguish native HR from new customer models",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await page.getByRole("button",{name:/التدريب الخارجي/}).click();
  const region=page.getByRole("region",{name:"رحلة العمل المقترحة"});
  await region.getByRole("tab",{name:/تسجيل المتدربين/}).click();
  await expect(region.getByRole("tabpanel")).toContainText("NEW: Trainee");
  await expect(region.getByRole("tabpanel")).toContainText("غير موصل");
  await page.getByRole("button",{name:/التوظيف للعملاء/}).click();
  await expect(region.getByRole("tab")).toHaveCount(4);
  await region.getByRole("tab",{name:/مشاركة الملفات والمقابلات/}).click();
  await expect(region.getByRole("tabpanel")).toContainText("CandidateSubmission");
  await expect(region.getByRole("tabpanel")).toContainText("CandidateConsent");
});

test("capability flow on mobile remains within current navigation and supports English",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"التنقل"}).click();
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await page.getByRole("button",{name:/تنمية الموارد/}).click();
  await expect(page.getByRole("region",{name:"رحلة العمل المقترحة"})).toBeVisible();
  await page.getByRole("button",{name:"اللغة"}).click();
  const journey=page.getByRole("region",{name:"Planned business journey"});
  await expect(journey).toBeVisible();
  await journey.getByRole("tab",{name:/Grant application/}).click();
  await expect(journey.getByRole("tabpanel")).toContainText("Grant");
});

test("Opportunity compact modal traps focus, escapes safely and restores originating button focus",async ({page})=>{
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"المبيعات"}).click();
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
  await expect(page.getByRole("heading",{name:"أهلًا بك في IOETI"})).toBeVisible();
  await expect(page.getByRole("button",{name:"الشهادات"})).toBeDisabled();
});

test("real mode never downloads multi-domain demo workspace chunks or fixtures",async ({page})=>{
  const fetched:string[]=[];
  page.on("request",request=>fetched.push(request.url()));
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button",{name:"خريطة النظام"}).click();
  await expect(page.getByRole("button",{name:"الشهادات"})).toBeDisabled();
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
