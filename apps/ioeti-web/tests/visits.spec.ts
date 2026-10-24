import { expect, test, type Page, type Route } from "@playwright/test";

/** Field visits and visit numbering against a mocked API; the live API is covered by scripts/visit_probe.py. */

const NEXT: Record<string, Record<string, string>> = {
  start: { PLANNED: "STARTED", SUSPENDED: "STARTED" }, suspend: { STARTED: "SUSPENDED" },
  finish: { STARTED: "FINISHED", SUSPENDED: "FINISHED" }, cancel: { TO_PLAN: "CANCELLED", PLANNED: "CANCELLED", SUSPENDED: "CANCELLED" },
};
const local = (days: number, hour: number) => {
  const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00:00Z`;
};

async function mockVisits(page: Page, { numbered = true } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const base = { accountId: 7, type: null, assigneeId: 3, assigneeName: "سارة منصور", mine: true, plannedEnd: null, startedAt: null, finishedAt: null,
    durationSeconds: null, opportunityId: null, contractId: null };
  const visits = [
    { ...base, id: 1, version: 2, reference: "VIS-0001", status: "PLANNED", purpose: "زيارة تقييم أولى", accountName: "مصنع النور", plannedStart: local(0, 23) },
    { ...base, id: 2, version: 0, reference: "VIS-0002", status: "TO_PLAN", purpose: "متابعة", accountName: "شركة الدلتا", assigneeId: null, assigneeName: null, mine: false, plannedStart: null },
    { ...base, id: 3, version: 5, reference: "VIS-0003", status: "FINISHED", purpose: "تدقيق داخلي", accountName: "مصنع النور", plannedStart: local(-3, 10), durationSeconds: 5400 },
  ];
  const log: Record<number, { id: number; text: string; at: string; authorName: string; mine: boolean }[]> = { 1: [] };
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
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "sara", name: "سارة", language: "ar" }) });
    if (path === "/business-lines") return result([]);
    if (path === "/visits/types") return result([{ id: 4, name: "زيارة تقييم" }]);
    if (path === "/visits/people") return result([{ id: 3, name: "سارة منصور" }, { id: 8, name: "كريم حسن" }]);
    if (path === "/workspace/search") return result([{ type: "ACCOUNT", id: 7, title: "مصنع النور", subtitle: null }]);
    if (path === "/visits" && method === "GET") return result(url.searchParams.get("mine") ? visits.filter(v => v.mine) : visits);
    if (path === "/visits" && method === "POST") {
      if (!numbered) return failure(422, { code: "NUMBERING_REQUIRED", fields: [] });
      const added = { ...base, id: 9, version: 0, reference: "VIS-0004", status: body.start ? "PLANNED" : "TO_PLAN", purpose: String(body.purpose),
        accountName: "مصنع النور", plannedStart: body.start ? `${body.start}:00Z` : null, assigneeId: Number(body.assignedToId) || null,
        assigneeName: body.assignedToId === 8 ? "كريم حسن" : body.assignedToId ? "سارة منصور" : null, mine: body.assignedToId === 3 };
      visits.push(added); log[9] = [];
      return result(added, 201);
    }
    const one = path.match(/^\/visits\/(\d+)$/);
    if (one && method === "GET") {
      const v = visits.find(x => x.id === Number(one[1]))!;
      return result({ visit: v, log: log[v.id] ?? [] });
    }
    const note = path.match(/^\/visits\/(\d+)\/notes$/);
    if (note) {
      const v = visits.find(x => x.id === Number(note[1]))!;
      if (body.version !== v.version) return failure(409, { code: "CONFLICT", fields: [] });
      v.version += 1;
      const added = { id: 50 + (log[v.id] ?? []).length, text: String(body.text), at: local(0, 9), authorName: "سارة منصور", mine: true };
      (log[v.id] ??= []).unshift(added);
      return result(added, 201);
    }
    const command = path.match(/^\/visits\/(\d+)\/(start|suspend|finish|cancel)$/);
    if (command) {
      const v = visits.find(x => x.id === Number(command[1]))!;
      if (body.version !== v.version) return failure(409, { code: "CONFLICT", fields: [] });
      if (command[2] === "finish" && v.status === "SUSPENDED") return failure(422, { code: "CHECKLIST_INCOMPLETE", fields: [] });
      const to = NEXT[command[2]][v.status];
      if (!to) return failure(422, { code: "STATUS_NOT_ALLOWED", fields: [] });
      Object.assign(v, { status: to, version: v.version + 1 }, to === "FINISHED" ? { durationSeconds: 3600 } : {});
      return result(v);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, visits };
}

test("field visits: grouped by when; start, pause, resume and finish on site; the log is added to", async ({ page }) => {
  const { posted } = await mockVisits(page);
  await page.goto("/#/visits");
  await expect(page.getByRole("heading", { name: "الزيارات الميدانية", level: 1 })).toBeVisible();
  // "mine" by default: only the visits assigned to the signed-in person
  await expect(page.getByRole("region", { name: "النهارده" }).locator(".visit-card")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "محتاجة تخطيط" })).toHaveCount(0);
  await page.getByRole("button", { name: "كل الزيارات" }).click();
  await expect(page.getByRole("region", { name: "محتاجة تخطيط" }).getByText("شركة الدلتا")).toBeVisible();
  await expect(page.getByRole("region", { name: "خلصت أو اتلغت" }).locator(".visit-card")).toHaveCount(1);

  await page.getByRole("region", { name: "النهارده" }).getByRole("link", { name: /مصنع النور/ }).click();
  await expect(page).toHaveURL(/#\/visits\/1$/);
  await expect(page.getByRole("heading", { name: "مصنع النور", level: 1 })).toBeVisible();
  await expect(page.locator(".visit-ref")).toHaveText("VIS-0001");
  // a planned visit can be started, rescheduled or cancelled; not paused or finished
  await expect(page.getByRole("button", { name: "إيقاف مؤقت" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إنهاء الزيارة" })).toHaveCount(0);
  await page.getByRole("button", { name: "ابدأ الزيارة" }).click();
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("بدأت");
  await page.getByRole("button", { name: "إيقاف مؤقت" }).click();
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("متوقفة مؤقتًا");
  // the native rule refuses finishing a paused visit with unanswered checklist questions: explained, nothing changes
  await page.getByRole("button", { name: "إنهاء الزيارة" }).click();
  await expect(page.getByRole("alert")).toHaveText("جاوب أسئلة قائمة التحقق المطلوبة الأول.");
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("متوقفة مؤقتًا");
  await page.getByRole("button", { name: "كمّل الزيارة" }).click();
  await page.getByRole("button", { name: "إنهاء الزيارة" }).click();
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("خلصت");
  await expect(page.locator(".visit-actions")).toHaveCount(0);
  await expect(page.getByText("60 دقيقة")).toBeVisible();

  await expect(page.getByText("لسه مفيش ملاحظات.")).toBeVisible();
  await expect(page.getByRole("button", { name: "إضافة", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "اكتب ملاحظة…" }).fill("العميل طلب موعد التدقيق الأول في ديسمبر");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.locator(".visit-notes li")).toHaveCount(1);
  await expect(page.locator(".visit-notes li").first()).toContainText("العميل طلب موعد التدقيق الأول في ديسمبر");
  await expect(page.getByRole("textbox", { name: "اكتب ملاحظة…" })).toHaveValue("");
  const commands = posted.filter(p => /\/(start|suspend|finish)$/.test(p.path)).map(p => p.path.split("/").pop());
  expect(commands).toEqual(["start", "suspend", "finish", "start", "finish"]);
  expect(posted.every(p => typeof p.body.version === "number")).toBe(true);
});

test("a new visit: pick the account, choose who goes and when; cancelling asks first", async ({ page }) => {
  const { posted } = await mockVisits(page);
  await page.goto("/#/visits");
  await page.getByRole("button", { name: "زيارة جديدة" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "الحساب" }).fill("النور");
  await dialog.getByRole("option").getByRole("button", { name: "مصنع النور" }).click();
  await dialog.getByLabel("الغرض من الزيارة").fill("مراجعة الاستعداد للتدقيق");
  await dialog.getByLabel("مين رايح").selectOption({ label: "كريم حسن" });
  await expect(dialog.getByLabel("البداية")).toHaveValue(/T10:00$/);
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/visits\/9$/);
  const create = posted.find(p => p.path === "/visits")!;
  expect(create.body).toMatchObject({ accountId: 7, purpose: "مراجعة الاستعداد للتدقيق", assignedToId: 8 });
  expect(String(create.body.start)).toMatch(/T10:00$/);
  expect(typeof create.body.zone).toBe("string");
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("مخططة");

  await page.getByRole("button", { name: "إلغاء الزيارة" }).click();
  const confirm = page.getByRole("dialog", { name: "إلغاء الزيارة؟" });
  await expect(confirm).toContainText("مفيش رسالة هتتبعت للعميل");
  await confirm.getByRole("button", { name: "رجوع" }).click();
  expect(posted.some(p => p.path.endsWith("/cancel"))).toBe(false);
  await page.getByRole("button", { name: "إلغاء الزيارة" }).click();
  await page.getByRole("dialog", { name: "إلغاء الزيارة؟" }).getByRole("button", { name: "إلغاء الزيارة" }).click();
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("اتلغت");
  await expect(page.getByRole("textbox", { name: "اكتب ملاحظة…" })).toHaveCount(0);
});

test("without visit numbering a visit cannot be saved, and the person is told who can fix it", async ({ page }) => {
  await mockVisits(page, { numbered: false });
  await page.goto("/#/visits");
  await page.getByRole("button", { name: "زيارة جديدة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "الحساب" }).fill("النور");
  await dialog.getByRole("option").getByRole("button", { name: "مصنع النور" }).click();
  await dialog.getByLabel("الغرض من الزيارة").fill("زيارة");
  await dialog.getByRole("checkbox", { name: "حدد الموعد بعدين" }).check();
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("alert")).toContainText("مسؤول النظام يظبطه من لوحة الإدارة ← الترقيم");
  await expect(page).toHaveURL(/#\/visits$/);
});

test("admin numbering: field visits are flagged until an administrator sets the prefix; the preview shows the next number", async ({ page }) => {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const rows = [
    { code: "partner", name: "Accounts", configured: true, version: 3, prefix: "CUS", digits: 5, nextNumber: 42, example: "CUS00042" },
    { code: "intervention", name: "Field visits", configured: false, version: null, prefix: null, digits: null, nextNumber: null, example: null },
  ];
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
    if (path === "/admin/numbering" && method === "GET") return result(rows);
    if (path === "/admin/numbering/intervention") {
      if (!/^[A-Za-z0-9][A-Za-z0-9_/%-]{0,11}$/.test(String(body.prefix)))
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ codeStatus: 422, error: { code: "INVALID", fields: [{ field: "prefix", code: "FORMAT" }] } }) });
      Object.assign(rows[1], { configured: true, version: 0, prefix: body.prefix, digits: body.digits, nextNumber: 1, example: `${body.prefix}${"1".padStart(Number(body.digits), "0")}` });
      return result(rows[1]);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#/admin/numbering");
  const panel = page.getByRole("region", { name: "الترقيم" });
  await expect(panel.getByText("CUS00042")).toBeVisible();
  await expect(panel.getByText("مش متظبط")).toBeVisible();
  await expect(panel.getByText("مفيش زيارات هتتسجل لحد ما الترقيم ده يتظبط.")).toBeVisible();
  await panel.getByRole("button", { name: "ظبط الترقيم: الزيارات الميدانية" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("البادئة").fill("a b");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("البادئة مش صحيحة.");
  await dialog.getByLabel("البادئة").fill("VIS-");
  await dialog.getByLabel("عدد الأرقام").fill("3");
  await expect(dialog.locator(".admin-numbering-preview code")).toHaveText("VIS-001");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByText("VIS-001")).toBeVisible();
  await expect(panel.getByText("مفيش زيارات هتتسجل لحد ما الترقيم ده يتظبط.")).toHaveCount(0);
  expect(posted.at(-1)).toEqual({ path: "/admin/numbering/intervention", body: { prefix: "VIS-", digits: 3 } });
});
