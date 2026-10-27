import { expect, test, type Page, type Route } from "@playwright/test";

/** Daily work (journeys plan, phase 2) against a mocked API; the live API is covered by scripts/daily_work_probe.py. */

type Posted = { method: string; path: string; body: Record<string, unknown> };
const stages = [
  { id: 1, name: "New", kind: "OPEN" }, { id: 2, name: "Qualification", kind: "OPEN" }, { id: 3, name: "Proposition", kind: "OPEN" },
  { id: 4, name: "Closed won", kind: "WON" }, { id: 5, name: "Closed lost", kind: "LOST" },
];

async function mockDaily(page: Page, options: { reasons?: { id: number; name: string }[] } = {}) {
  const posted: Posted[] = [];
  const account = { id: 31, version: 3, name: "شركة الأمل للتجارة", reference: "P1070", customer: false, prospect: true };
  const lead = { id: 50, version: 4, name: "أحمد عادل", organization: "مصنع الدلتا", stage: "New", converted: false, businessLineCode: "ISO9001",
    accountId: null, opportunityId: null, stageId: 1, stageKind: "OPEN", lostReason: null, assignedToMe: true, receivedAt: null };
  const opportunity = { id: 40, version: 6, name: "توريد أنظمة جودة", reference: "O2880", businessLineCode: "ISO9001", businessLineNameAr: "أيزو 9001",
    businessLineNameEn: "ISO 9001", stage: "Qualification", stageId: 2, stageKind: "OPEN", amount: 0, currencyCode: null, expectedCloseDate: null,
    probability: 0, lostReason: null as string | null };
  const activities: Record<string, unknown>[] = [];
  const today = new Date();
  const at = (days: number, hour: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`;
  };
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) ?? {} : {};
    if (method === "POST") posted.push({ method, path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    const failure = (code: number, error: Record<string, unknown>) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, error }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "sara.mansour", name: "سارة منصور", language: "ar", administrator: false }) });
    if (path === "/business-lines" || path === "/business-lines/creatable") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 10, responsibleTeam: null }]);
    // accounts
    if (path === "/accounts" && method === "GET") return result([account]);
    if (path === "/accounts/similar") return result(String(body.name).includes("الامل") ? [account] : []);
    if (path === "/accounts" && method === "POST") {
      if (!body.confirmNotDuplicate && String(body.name).includes("الامل")) return failure(409, { code: "POSSIBLE_DUPLICATE", fields: [] });
      return result({ id: 32, version: 0, name: body.name, reference: "P1071", customer: false, prospect: true }, 201);
    }
    if (path === "/accounts/31" && method === "GET") return result(account);
    if (path === "/accounts/32" && method === "GET") return result({ id: 32, version: 0, name: "شركة الامل الجديدة", reference: "P1071", customer: false, prospect: true });
    if (path === "/accounts/31/contacts" && method === "POST") { account.version += 1; return result({ id: 77, name: "هدى سمير", jobTitle: null }, 201); }
    // leads
    if (path === "/leads/50" && method === "GET") return result(lead);
    if (path === "/marketing/leads/50" && method === "POST") {
      Object.assign(lead, { name: body.name, organization: body.organization, version: lead.version + 1 });
      return result(lead);
    }
    // opportunities
    if (path === "/opportunities/stages") return result(stages);
    if (path === "/opportunities/lost-reasons") return result(options.reasons ?? [{ id: 8, name: "السعر" }, { id: 9, name: "اختاروا منافس" }]);
    if (path === "/opportunities/40" && method === "GET") return result(opportunity);
    const command = path.match(/^\/opportunities\/40\/(stage|lose|reopen|plan)$/);
    if (command) {
      if (body.version !== opportunity.version) return failure(409, { code: "CONFLICT", fields: [] });
      if (command[1] === "stage") {
        const target = stages.find(s => s.id === body.stageId)!;
        if (target.kind === "WON") return failure(422, { code: "WON_EVIDENCE_MISSING", fields: [] });
        Object.assign(opportunity, { stageId: target.id, stage: target.name, stageKind: target.kind });
      }
      if (command[1] === "lose") Object.assign(opportunity, { stageId: 5, stage: "Closed lost", stageKind: "LOST", lostReason: "السعر" });
      if (command[1] === "reopen") Object.assign(opportunity, { stageId: 1, stage: "New", stageKind: "OPEN", lostReason: null });
      if (command[1] === "plan") Object.assign(opportunity, { amount: Number(body.amount), currencyCode: body.currencyCode,
        expectedCloseDate: body.expectedCloseDate, probability: Number(body.probability) });
      opportunity.version += 1;
      return result(opportunity);
    }
    // activities, agenda, search
    if (path === "/workspace/activities" && method === "GET") return result(activities);
    if (path === "/workspace/activities" && method === "POST") {
      const saved = { id: 100 + activities.length, version: 0, kind: body.kind, status: body.planned ? "PLANNED" : "DONE", subject: body.subject,
        at: body.at ?? at(0, 9), ownerName: "سارة منصور", mine: true, outcomeRecorded: !!body.outcome };
      activities.unshift(saved);
      if (body.record === "ACCOUNT") account.version += 1;
      if (body.record === "OPPORTUNITY") opportunity.version += 1;
      return result(saved, 201);
    }
    if (path === "/workspace/agenda") return result([
      { type: "ACTIVITY", id: 300, title: "اجتماع مراجعة العرض", at: at(0, 11), endsAt: at(0, 12), kind: "MEETING", status: "PLANNED", recordType: "OPPORTUNITY", recordId: 40 },
      { type: "INTERVIEW", id: 301, title: "محاسب أول", at: at(1, 13), endsAt: null, kind: null, status: null, recordType: "JOB_ORDER", recordId: 12 },
      { type: "AUDIT", id: 302, title: null, at: at(2, 0), endsAt: null, kind: null, status: null, recordType: "CYCLE", recordId: 5 },
    ]);
    if (path === "/workspace/search") {
      const q = url.searchParams.get("q") ?? "";
      if (q.length < 2) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "q", code: "TOO_SHORT" }] });
      return result([{ type: "ACCOUNT", id: 31, title: "شركة الأمل للتجارة", subtitle: "P1070" }, { type: "OPPORTUNITY", id: 40, title: "توريد أنظمة جودة", subtitle: "O2880" }]);
    }
    if (path === "/marketing/leads/50/consents") return result({ channels: [], history: [] });
    if (path === "/marketing/leads/50/attribution") return result({ sourceId: null, sourceName: null, campaigns: [] });
    if (path === "/workspace/account360/31") return result({ id: 31, name: account.name, sections: [], money: [] });
    if (path === "/accounts/31/contacts" || path === "/accounts/31/opportunities" || path === "/opportunities" || path === "/leads/stages") return result([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, opportunity };
}

test("a rep adds an account: a similar name is shown and a likely duplicate needs a confirmation", async ({ page }) => {
  const { posted } = await mockDaily(page);
  await page.goto("/#/accounts");
  await page.getByRole("button", { name: "حساب جديد" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("اسم الشركة").fill("شركة الامل الجديدة");
  await expect(dialog.getByText("حسابات مشابهة موجودة")).toBeVisible();
  await expect(dialog.getByText("شركة الأمل للتجارة")).toBeVisible();
  await dialog.getByLabel("بريد الشركة").fill("info@amal.example");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("alert")).toContainText("في سجل مشابه");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled();
  await dialog.getByLabel("تأكيد أنه سجل مختلف").check();
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/accounts\/32$/);
  const saves = posted.filter(p => p.path === "/accounts");
  expect(saves).toHaveLength(2);
  expect(saves[1].body).toMatchObject({ name: "شركة الامل الجديدة", email: "info@amal.example", confirmNotDuplicate: true });
});

test("a rep logs a call on an account, adds a contact, and the outcome stays private", async ({ page }) => {
  const { posted } = await mockDaily(page);
  await page.goto("/#/accounts/31");
  await expect(page.getByRole("heading", { name: "شركة الأمل للتجارة" })).toBeVisible();
  const panel = page.locator(".activity-panel");
  await expect(panel.getByText("لا توجد أنشطة بعد")).toBeVisible();
  await panel.getByLabel("الموضوع").fill("مكالمة تعريفية");
  await panel.getByLabel("النتيجة (اختياري)").fill("طلبوا عرض سعر");
  await panel.getByRole("button", { name: "تسجيل" }).click();
  await expect(panel.locator(".activity-item")).toHaveCount(1);
  await expect(panel.getByText("نتيجة مسجلة")).toBeVisible();
  await expect(panel.locator(".activity-list")).not.toContainText("طلبوا عرض سعر");
  const log = posted.find(p => p.path === "/workspace/activities")!.body;
  expect(log).toMatchObject({ record: "ACCOUNT", recordId: 31, version: 3, kind: "CALL", planned: false, outcome: "طلبوا عرض سعر" });
  // plan a meeting: the time defaults to tomorrow and no outcome is asked for
  await panel.getByRole("button", { name: "اجتماع" }).click();
  await panel.getByRole("button", { name: "مخطط" }).click();
  await expect(panel.getByLabel("النتيجة (اختياري)")).toHaveCount(0);
  await panel.getByLabel("الموضوع").fill("زيارة للمصنع");
  await panel.getByRole("button", { name: "تسجيل" }).click();
  await expect(panel.locator(".activity-item.is-planned")).toHaveCount(1);
  // the account was read again after each change, so the next command carries the new version
  await page.getByRole("button", { name: "إضافة جهة اتصال" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("اسم العائلة").fill("سمير");
  await dialog.getByLabel("الاسم الأول").fill("هدى");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posted.find(p => p.path === "/accounts/31/contacts")!.body).toMatchObject({ version: 5, firstName: "هدى", name: "سمير" });
});

test("the opportunity path: open stages move, won asks for the line's evidence (D-11), lost needs a reason, then reopen and estimate", async ({ page }) => {
  const { posted, opportunity } = await mockDaily(page);
  await page.goto("/#/opportunities/40");
  const rail = page.locator(".stage-rail-card");
  await expect(rail.getByRole("button", { name: /المرحلة الحالية/ })).toBeVisible();
  await expect(rail).toContainText("D-11");
  await rail.getByRole("button", { name: "تسجيل كمكسوبة" }).click();
  await expect(rail.getByRole("alert")).toHaveText(/لسه مفيش دليل التزام/);
  expect(posted.find(p => p.path === "/opportunities/40/stage")!.body).toEqual({ version: 6, stageId: 4 });
  await rail.locator(".stage-step").nth(2).getByRole("button").click();
  await expect.poll(() => opportunity.stageId).toBe(3);
  expect(posted.filter(p => p.path === "/opportunities/40/stage").at(-1)!.body).toEqual({ version: 6, stageId: 3 });
  await expect(rail.locator(".stage-step.is-current")).toHaveCount(1);
  await expect(rail.locator(".stage-step").nth(2)).toHaveClass(/is-current/);
  await rail.getByRole("button", { name: "تسجيل كخاسرة" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled();
  await dialog.getByText("السعر").click();
  await dialog.getByLabel("ملاحظة (اختياري)").fill("اختاروا عرض أرخص");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(rail).toContainText("خاسرة · السعر");
  expect(posted.find(p => p.path === "/opportunities/40/lose")!.body).toMatchObject({ lostReasonId: 8, note: "اختاروا عرض أرخص" });
  await rail.getByRole("button", { name: "إعادة فتح" }).click();
  await expect(rail.getByRole("button", { name: "تسجيل كخاسرة" })).toBeVisible();
  await page.getByRole("button", { name: "تعديل التقدير" }).click();
  const plan = page.getByRole("dialog");
  await plan.getByLabel("القيمة المتوقعة").fill("150000");
  await plan.getByLabel(/احتمال الفوز/).fill("40");
  await plan.getByRole("button", { name: "حفظ" }).click();
  await expect(page.locator(".plan-card")).toContainText("40%");
  await expect(page.locator(".plan-card")).toContainText("تقدير فقط");
  expect(posted.find(p => p.path === "/opportunities/40/plan")!.body).toMatchObject({ amount: "150000", currencyCode: "EGP", probability: "40" });
});

test("a rep edits a lead with one name field; phone and e-mail are never prefilled", async ({ page }) => {
  const { posted } = await mockDaily(page);
  await page.goto("/#/leads/50");
  await page.getByRole("button", { name: "تعديل البيانات" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("الاسم بالكامل")).toHaveValue("أحمد عادل");
  await expect(dialog.getByLabel("هاتف جديد")).toHaveValue("");
  await dialog.getByLabel("الاسم بالكامل").fill("أحمد عادل حسن");
  await dialog.getByLabel("الجهة").fill("مصنع الدلتا للأغذية");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("heading", { name: "أحمد عادل حسن" })).toBeVisible();
  const body = posted.find(p => p.path === "/marketing/leads/50")!.body;
  expect(body).toMatchObject({ version: 4, firstName: "", name: "أحمد عادل حسن", organization: "مصنع الدلتا للأغذية" });
  expect(body).not.toHaveProperty("phone");
  expect(body).not.toHaveProperty("businessLineCode");
});

test("Ctrl+K also jumps to a page the person can open, whatever the hamza or taa marbuta; pages come before records", async ({ page }) => {
  await mockDaily(page);
  await page.goto("/#/agenda");
  await expect(page.getByRole("heading", { name: "التقويم" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  // written without the hamza, "الاشعارات" still finds the notifications page
  await palette.getByRole("combobox").fill("الاشعارات");
  await expect(palette.getByRole("option").first()).toContainText("الإشعارات");
  await expect(palette.getByRole("option").first()).toContainText("صفحة");
  await palette.getByRole("combobox").fill("الفواتير");
  const first = palette.getByRole("option").first();
  await expect(first).toContainText("الفواتير والتحصيل");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/finance$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // the breadcrumb names the page's area, from the same table as the menu
  await expect(page.locator(".breadcrumb")).toContainText("التنفيذ والخدمات");
  await expect(page.locator(".breadcrumb strong")).toHaveText("الفواتير والتحصيل");
  await expect(page).toHaveTitle("الفواتير والتحصيل · IOETI");
});

test("the calendar list groups the fortnight by day, and Ctrl+K finds and opens a record", async ({ page }) => {
  await mockDaily(page);
  await page.goto("/#/agenda");
  await expect(page.getByRole("heading", { name: "التقويم" })).toBeVisible();
  await page.getByRole("button", { name: "قائمة", exact: true }).click();
  await expect(page.locator(".agenda-day")).toHaveCount(3);
  await expect(page.locator(".agenda-day.is-today")).toContainText("اجتماع مراجعة العرض");
  await expect(page.getByText("تدقيق مخطط")).toBeVisible();
  await expect(page.locator(".agenda-item.is-interview a")).toHaveAttribute("href", "#/recruitment/orders/12");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("ا");
  await expect(palette).toContainText("اكتب حرفين على الأقل");
  await palette.getByRole("combobox").fill("الامل");
  await expect(palette.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(palette.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/opportunities\/40$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("with no lost reasons set up, the lose dialog says so and cannot be saved", async ({ page }) => {
  const { posted } = await mockDaily(page, { reasons: [] });
  await page.goto("/#/opportunities/40");
  await page.getByRole("button", { name: "تسجيل كخاسرة" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText("لم تُضف أسباب خسارة بعد");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled();
  expect(posted.some(p => p.path.endsWith("/lose"))).toBe(false);
});

test("visits and quality on the shared surfaces: a corrective action due on my agenda, visits and issues in search, and on Account 360", async ({ page }) => {
  await mockDaily(page);
  const today = new Date();
  const day = (n: number) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`; };
  const ok = (object: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ codeStatus: 200, messageStatus: "ok", object }) });
  // routes registered later take precedence over the shared mock
  await page.route("**/ws/ioeti/workspace/agenda*", route => route.fulfill(ok([
    { type: "VISIT", id: 7, title: "مصنع النور", at: day(1).replace("T00", "T10"), endsAt: null, kind: null, status: "PLANNED", recordType: "VISIT", recordId: 7 },
    { type: "ACTION", id: 101, title: "قالب تقرير موحد", at: day(2), endsAt: null, kind: null, status: "OPEN", recordType: "QUALITY", recordId: 9 },
  ])));
  await page.route("**/ws/ioeti/workspace/search*", route => route.fulfill(ok([
    { type: "ACCOUNT", id: 31, title: "مصنع النور", subtitle: "P1070" },
    { type: "VISIT", id: 7, title: "مصنع النور", subtitle: "VIS-0007" },
    { type: "QUALITY", id: 9, title: "شكوى مصنع النور من تأخير التقرير", subtitle: "QI-009" },
  ])));
  await page.route("**/ws/ioeti/workspace/account360/31", route => route.fulfill(ok({ id: 31, name: "شركة الأمل للتجارة",
    sections: [{ key: "FIELD_VISITS", count: 2, permitted: true }, { key: "QUALITY_ISSUES", count: 1, permitted: true }], money: [] })));

  await page.goto("/#/agenda");
  await page.getByRole("button", { name: "قائمة", exact: true }).click();
  const action = page.locator(".agenda-item.is-action");
  await expect(action).toContainText("قالب تقرير موحد");
  await expect(action).toContainText("إجراء تصحيحي مستحق");
  await expect(action).toContainText("طوال اليوم");
  await expect(action.locator("a")).toHaveAttribute("href", "#/quality/9");
  await expect(page.locator(".agenda-item.is-visit a")).toHaveAttribute("href", "#/visits/7");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("النور");
  await expect(palette.getByRole("option")).toHaveCount(3);
  await expect(palette.getByRole("option").nth(1)).toContainText("زيارة ميدانية");
  await expect(palette.getByRole("option").nth(2)).toContainText("مشكلة جودة");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/quality\/9$/);

  await page.goto("/#/accounts/31");
  const summary = page.locator(".wf-summary");
  await expect(summary.getByRole("link", { name: /الزيارات الميدانية/ })).toHaveAttribute("href", "#/visits");
  await expect(summary.getByRole("link", { name: /مشاكل الجودة/ })).toHaveAttribute("href", "#/quality");
  await expect(summary.getByRole("link", { name: /الزيارات الميدانية/ })).toContainText("2");
});
