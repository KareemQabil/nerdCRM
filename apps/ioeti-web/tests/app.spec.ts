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
