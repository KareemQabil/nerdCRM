import { expect, test, type Page, type Route } from "@playwright/test";

/** Quality issues, corrective actions and the quality set-up against a mocked API; the live API is covered by scripts/quality_probe.py. */

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

function issue(over: Record<string, unknown>) {
  return { id: 1, version: 0, reference: "QI26-0001", title: "تأخير تسليم تقرير التدقيق", gravity: "MAJOR", statusId: 10, statusName: "قيد المعالجة", statusKind: "OPEN",
    detection: "تدقيق داخلي", origin: "INTERNAL", issueType: "تأخير تقرير", accountId: null, accountName: null, projectId: null, projectName: null,
    ownerId: 3, ownerName: "سارة منصور", mine: true, raisedAt: "2026-10-20T10:00:00Z", raisedByName: "سارة منصور", dueDate: iso(30), progress: 0,
    openActions: 0, overdueActions: 0, effectiveness: "NOT_CHECKED", ...over };
}

async function mockQuality(page: Page, { ready = true, administrator = false } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const issues = [
    issue({}),
    issue({ id: 2, reference: "QI26-0002", title: "شكوى من مدرب في دورة 45001", gravity: "CRITICAL", detection: "شكوى عميل", origin: "CUSTOMER", accountId: 7,
      accountName: "مصنع النور", mine: false, ownerName: "كريم حسن", overdueActions: 1, openActions: 2, progress: 33 }),
  ];
  const detail = { issue: issues[0], details: "التقرير اتسلم بعد 12 يوم", objective: null as string | null, criteria: null as string | null, earliest: null,
    check: null as string | null, checkedByName: null as string | null, checkedAt: null as string | null, actions: [] as Record<string, unknown>[] };
  const options = ready ? { ready: true, missing: [],
    statuses: [{ id: 10, name: "قيد المعالجة", kind: "OPEN" }, { id: 11, name: "مقفولة", kind: "CLOSED" }],
    detections: [{ id: 20, name: "تدقيق داخلي", kind: "INTERNAL" }, { id: 21, name: "شكوى عميل", kind: "CUSTOMER" }],
    issueTypes: [{ id: 30, name: "تأخير تقرير", kind: null }], actionTypes: [{ id: 40, name: "تعديل إجراء", kind: null }] }
    : { ready: false, missing: ["STATUSES", "ISSUE_TYPES"], statuses: [], detections: [], issueTypes: [], actionTypes: [] };
  const progress = () => {
    const live = detail.actions.filter(a => a.status !== "CANCELLED");
    detail.issue.progress = live.length ? Math.floor(100 * live.filter(a => a.status === "DONE").length / live.length) : 0;
    detail.issue.openActions = live.filter(a => a.status === "OPEN").length;
  };
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) ?? {} : {};
    if (method === "POST") posted.push({ path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    const failure = (code: number, error: Record<string, unknown>) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, error }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "sara", name: "سارة", language: "ar", administrator }) });
    if (path === "/business-lines" || path === "/opportunities/stages") return result([]);
    if (path === "/quality/options") return result(options);
    if (path === "/quality/people") return result([{ id: 3, name: "سارة منصور", kind: null }, { id: 8, name: "كريم حسن", kind: null }]);
    if (path === "/workspace/search") return result([{ type: "ACCOUNT", id: 7, title: "مصنع النور", subtitle: null }]);
    if (path === "/quality" && method === "GET") {
      const state = url.searchParams.get("state");
      return result(issues.filter(i => state === "all" || (state === "closed" ? i.statusKind !== "OPEN" : i.statusKind === "OPEN")));
    }
    if (path === "/quality" && method === "POST") {
      const raised = issue({ id: 9, reference: "QI26-0009", title: body.title, gravity: body.gravity, accountId: body.accountId ?? null,
        accountName: body.accountId ? "مصنع النور" : null, detection: body.detectionId === 21 ? "شكوى عميل" : "تدقيق داخلي" });
      Object.assign(detail, { issue: raised, details: body.details ?? null });
      return result(detail, 201);
    }
    const one = path.match(/^\/quality\/(\d+)$/);
    if (one) return result(detail);
    const stale = () => body.version !== detail.issue.version;
    if (/\/plan$/.test(path)) {
      if (stale()) return failure(409, { code: "CONFLICT", fields: [] });
      Object.assign(detail, { objective: body.objective ?? null, criteria: body.criteria ?? null });
      Object.assign(detail.issue, { version: detail.issue.version + 1, ownerId: body.ownerId, ownerName: body.ownerId === 8 ? "كريم حسن" : "سارة منصور", mine: body.ownerId === 3, dueDate: body.latest ?? null });
      return result(detail);
    }
    if (/\/actions$/.test(path)) {
      if (stale()) return failure(409, { code: "CONFLICT", fields: [] });
      detail.actions.push({ id: 100 + detail.actions.length, version: 0, title: body.title, ownerId: body.ownerId, ownerName: body.ownerId === 8 ? "كريم حسن" : "سارة منصور",
        mine: body.ownerId === 3, due: body.due ?? null, type: body.typeId === 40 ? "تعديل إجراء" : null, status: "OPEN", overdue: !!body.due && String(body.due) < iso(0), doneAt: null, outcome: null });
      detail.issue.version += 1; progress();
      return result(detail, 201);
    }
    const act = path.match(/\/actions\/(\d+)\/(done|reopen|cancel)$/);
    if (act) {
      const a = detail.actions.find(x => x.id === Number(act[1]))!;
      if (body.version !== a.version) return failure(409, { code: "CONFLICT", fields: [] });
      Object.assign(a, { version: Number(a.version) + 1, status: act[2] === "done" ? "DONE" : act[2] === "cancel" ? "CANCELLED" : "OPEN",
        doneAt: act[2] === "done" ? "2026-10-24T12:00:00Z" : null, outcome: act[2] === "done" ? body.outcome ?? null : a.outcome, overdue: false });
      detail.issue.version += 1; progress();
      return result(detail);
    }
    if (/\/effectiveness$/.test(path)) {
      if (stale()) return failure(409, { code: "CONFLICT", fields: [] });
      Object.assign(detail, { check: body.check, checkedByName: "سارة منصور", checkedAt: "2026-10-24T12:00:00Z" });
      Object.assign(detail.issue, { version: detail.issue.version + 1, effectiveness: body.effective ? "EFFECTIVE" : "NOT_EFFECTIVE" });
      return result(detail);
    }
    if (/\/status$/.test(path)) {
      if (stale()) return failure(409, { code: "CONFLICT", fields: [] });
      const s = options.statuses.find(x => x.id === body.statusId)!;
      Object.assign(detail.issue, { version: detail.issue.version + 1, statusId: s.id, statusName: s.name, statusKind: s.kind });
      return result(detail);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, detail };
}

test("the quality register: gravity at a glance, overdue actions counted, and the open / closed filter", async ({ page }) => {
  const { posted } = await mockQuality(page);
  await page.goto("/#/quality");
  await expect(page.getByRole("heading", { name: "الجودة والإجراءات التصحيحية", level: 1 })).toBeVisible();
  await expect(page.locator(".quality-card")).toHaveCount(2);
  await expect(page.locator(".quality-card.is-critical")).toContainText("شكوى من مدرب");
  await expect(page.locator(".quality-card.is-critical")).toContainText("مصنع النور");
  await expect(page.locator(".quality-stats")).toContainText("حرجة مفتوحة1");
  await expect(page.locator(".quality-stats")).toContainText("إجراءات متأخرة1");
  await page.getByRole("button", { name: "مقفولة" }).click();
  await expect(page.locator(".quality-card")).toHaveCount(0);
  await expect(page.getByText("مفيش مشاكل هنا.")).toBeVisible();
  expect(posted).toHaveLength(0);
});

test("before the quality set-up is complete, raising is off and the person is told what is missing", async ({ page }) => {
  await mockQuality(page, { ready: false, administrator: true });
  await page.goto("/#/quality");
  const note = page.getByRole("note");
  await expect(note).toContainText("إعداد الجودة لسه ناقص");
  await expect(note).toContainText("حالة مفتوحة واحدة على الأقل");
  await expect(note).toContainText("نوع مشكلة");
  await expect(note.getByRole("link", { name: "افتح إعداد الجودة" })).toHaveAttribute("href", "#/admin/quality");
  await expect(page.getByRole("button", { name: "تسجيل مشكلة" })).toBeDisabled();
});

test("raise a client complaint (the client is required for that source), then plan, act, judge effectiveness and close", async ({ page }) => {
  const { posted } = await mockQuality(page);
  await page.goto("/#/quality");
  await page.getByRole("button", { name: "تسجيل مشكلة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("عنوان المشكلة").fill("العميل اشتكى من تأخير الشهادة");
  await dialog.getByLabel("إيه اللي حصل؟").fill("الشهادة اتأخرت 3 أسابيع بعد قرار المنح");
  await dialog.getByText("حرجة").click();
  await dialog.getByLabel("اتعرفت منين").selectOption({ label: "شكوى عميل · عميل" });
  await expect(dialog.getByText("مطلوب للمصدر ده")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "الحساب" }).fill("النور");
  await dialog.getByRole("option").getByRole("button", { name: "مصنع النور" }).click();
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/quality\/9$/);
  expect(posted.find(p => p.path === "/quality")!.body).toMatchObject({ gravity: "CRITICAL", detectionId: 21, issueTypeId: 30, accountId: 7 });
  await expect(page.getByRole("heading", { name: "العميل اشتكى من تأخير الشهادة", level: 1 })).toBeVisible();
  await expect(page.locator(".quality-hero .quality-gravity")).toContainText("حرجة");

  await page.getByRole("button", { name: "تعديل الخطة" }).click();
  const plan = page.getByRole("dialog");
  await plan.getByLabel("مسؤول الخطة").selectOption({ label: "كريم حسن" });
  await plan.getByLabel("الهدف").fill("الشهادات تتصدر خلال أسبوع من القرار");
  await plan.getByLabel("إزاي هنحكم على الفعالية").fill("مفيش شهادة تتأخر أكتر من 7 أيام لمدة 3 شهور");
  await plan.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".quality-plan")).toContainText("كريم حسن");
  await expect(page.locator(".quality-plan")).toContainText("مفيش شهادة تتأخر");

  const form = page.getByRole("form", { name: "إضافة إجراء" });
  await form.getByLabel("الإجراء").fill("متابعة يومية لقرارات المنح");
  await form.getByLabel("مين هيعمله").selectOption({ label: "سارة منصور" });
  await form.getByLabel("الموعد").fill(iso(-2));
  await form.getByLabel("النوع").selectOption({ label: "تعديل إجراء" });
  await form.getByRole("button", { name: "إضافة إجراء" }).click();
  await form.getByLabel("الإجراء").fill("قالب خطاب التأخير");
  await form.getByLabel("مين هيعمله").selectOption({ label: "كريم حسن" });
  await form.getByRole("button", { name: "إضافة إجراء" }).click();
  await expect(page.locator(".quality-action")).toHaveCount(2);
  await expect(page.locator(".quality-action.is-overdue")).toContainText("متأخر");

  await page.locator(".quality-action").first().getByRole("button", { name: "تم" }).click();
  await page.getByRole("dialog").getByLabel("اللي اتعمل (اختياري)").fill("بقت متابعة يومية في اجتماع الصبح");
  await page.getByRole("dialog").getByRole("button", { name: "تم" }).click();
  await expect(page.locator(".quality-action.is-done")).toContainText("بقت متابعة يومية");
  await expect(page.locator(".quality-plan")).toContainText("50%");

  // closing with an open action and no effectiveness check is allowed, but the person is reminded first
  await page.getByRole("button", { name: "مقفولة" }).click();
  const confirm = page.getByRole("dialog", { name: "نقل المشكلة؟" });
  await expect(confirm).toContainText("فيه 1 إجراء لسه مفتوح.");
  await expect(confirm).toContainText("الفعالية لسه متقيّمتش.");
  await confirm.getByRole("button", { name: "رجوع" }).click();

  await page.locator(".quality-action").nth(1).getByRole("button", { name: "إلغاء الإجراء: قالب خطاب التأخير" }).click();
  await expect(page.locator(".quality-plan")).toContainText("100%");
  await page.getByRole("button", { name: "قيّم الفعالية" }).click();
  const eff = page.getByRole("dialog");
  await expect(eff.getByRole("button", { name: "حفظ" })).toBeDisabled();
  await eff.getByText("فعّالة: المشكلة متكررتش").click();
  await eff.getByLabel("اللي اتراجع").fill("راجعنا 3 شهور: كل الشهادات خلال أسبوع");
  await eff.getByRole("button", { name: "حفظ" }).click();
  await expect(page.locator(".quality-effectiveness")).toContainText("الإجراءات فعّالة");
  await page.getByRole("button", { name: "مقفولة" }).click();
  const close = page.getByRole("dialog", { name: "نقل المشكلة؟" });
  await expect(close.locator(".quality-warn")).toHaveCount(0);
  await close.getByRole("button", { name: "نقل إلى: مقفولة" }).click();
  await expect(page.locator(".quality-hero .quality-status")).toHaveText("مقفولة");
  await expect(page.getByRole("form", { name: "إضافة إجراء" })).toHaveCount(0);
  const versions = posted.filter(p => p.path !== "/quality").map(p => p.body.version);
  expect(versions.every(v => typeof v === "number")).toBe(true);
});

test("admin quality set-up: statuses with their kind, detections with their origin; values in use cannot be deleted", async ({ page }) => {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const lists: Record<string, Record<string, unknown>[]> = {
    statuses: [{ id: 1, version: 0, name: "قيد المعالجة", code: null, kind: "OPEN", sequence: 10, uses: 3 }],
    detections: [], "issue-types": [], "action-types": [],
  };
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) ?? {} : {};
    if (method === "POST") posted.push({ path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "admin", name: "Admin", language: "ar", administrator: true }) });
    if (path === "/business-lines" || path === "/opportunities/stages") return result([]);
    const list = path.match(/^\/admin\/quality\/([a-z-]+)$/);
    if (list && method === "GET") return result(lists[list[1]]);
    if (list && method === "POST") {
      if (list[1] === "issue-types") return route.fulfill({ status: 422, contentType: "application/json",
        body: JSON.stringify({ codeStatus: 422, error: { code: "COMPANY_REQUIRED", fields: [] } }) });
      const added = { id: 50 + lists[list[1]].length, version: 0, name: body.name, code: list[1] === "detections" ? "DET-1" : null, kind: body.kind ?? null, sequence: 20, uses: 0 };
      lists[list[1]].push(added);
      return result(added, 201);
    }
    const change = path.match(/^\/admin\/quality\/([a-z-]+)\/(\d+)$/);
    if (change) {
      const row = lists[change[1]].find(r => r.id === Number(change[2]))!;
      Object.assign(row, { name: body.name, kind: body.kind ?? row.kind, version: Number(row.version) + 1 });
      return result(row);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#/admin/quality");
  await expect(page.getByText("مفيش قيم جاهزة")).toBeVisible();
  const panel = page.getByRole("region", { name: "الحالات" });
  await expect(panel.getByRole("button", { name: "حذف: قيد المعالجة" })).toBeDisabled();
  await panel.getByRole("textbox", { name: "الحالات" }).fill("مقفولة");
  await panel.getByLabel("نوع الحالة").selectOption({ label: "مقفولة" });
  await panel.getByRole("button", { name: "إضافة" }).click();
  await expect(panel.getByText("✓ مقفولة")).toBeVisible();
  expect(posted.at(-1)).toEqual({ path: "/admin/quality/statuses", body: { name: "مقفولة", kind: "CLOSED" } });
  await page.getByRole("tab", { name: "مصادر الاكتشاف" }).click();
  const det = page.getByRole("region", { name: "مصادر الاكتشاف" });
  await det.getByRole("textbox", { name: "مصادر الاكتشاف" }).fill("شكوى عميل");
  await det.getByLabel("المصدر").selectOption({ label: "عميل" });
  await det.getByRole("button", { name: "إضافة" }).click();
  await expect(det.getByText("DET-1")).toBeVisible();
  await det.getByLabel("النوع: شكوى عميل").selectOption({ label: "مورد" });
  await expect.poll(() => posted.at(-1)).toEqual({ path: "/admin/quality/detections/50", body: { version: 0, name: "شكوى عميل", kind: "SUPPLIER" } });
  await page.getByRole("tab", { name: "أنواع المشاكل" }).click();
  const types = page.getByRole("region", { name: "أنواع المشاكل" });
  await types.getByRole("textbox", { name: "أنواع المشاكل" }).fill("تأخير تقرير");
  await types.getByRole("button", { name: "إضافة" }).click();
  await expect(types.getByRole("alert")).toContainText("اختار الشركة النشطة الأول");
});
