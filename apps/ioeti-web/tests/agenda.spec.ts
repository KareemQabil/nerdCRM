import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/** The calendar (month, week, day, list) against a mocked API; the live API is covered by scripts/calendar_probe.py. */

type Posted = { path: string; body: Record<string, unknown> };
const pad = (n: number) => String(n).padStart(2, "0");
const today = new Date();
const at = (days: number, hour: number, minute = 0) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, minute);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function mockCalendar(page: Page, options: { people?: { id: number; name: string; me: boolean }[] } = {}) {
  const posted: Posted[] = [];
  const asked: string[] = [];
  const items = [
    { type: "ACTIVITY", id: 300, version: 2, movable: true, title: "اجتماع مراجعة العرض", at: at(0, 11), endsAt: at(0, 12), kind: "MEETING", status: "PLANNED", recordType: "OPPORTUNITY", recordId: 40 },
    { type: "SESSION", id: 310, version: null, movable: false, title: "دورة المراجع الداخلي", at: at(0, 9), endsAt: at(0, 13), kind: null, status: null, recordType: "COHORT", recordId: 3 },
    { type: "INTERVIEW", id: 301, version: null, movable: false, title: "محاسب أول", at: at(0, 11, 30), endsAt: null, kind: null, status: null, recordType: "JOB_ORDER", recordId: 12 },
    { type: "AUDIT", id: 302, version: null, movable: false, title: null, at: at(0, 0), endsAt: null, kind: null, status: null, recordType: "CYCLE", recordId: 5 },
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
      body: JSON.stringify({ code: "sara.mansour", name: "سارة منصور", language: "ar", administrator: false }) });
    if (path === "/workspace/agenda/overdue") return result([
      { type: "ACTIVITY", id: 290, version: 2, movable: true, title: "مكالمة متابعة مصنع الدلتا", at: at(-3, 10), endsAt: at(-3, 10, 30), kind: "CALL", status: "PLANNED", recordType: "LEAD", recordId: 50 },
    ]);
    if (path === "/workspace/agenda/people") return result(options.people ?? [{ id: 7, name: "سارة منصور", me: true }]);
    if (path === "/workspace/agenda") {
      asked.push(url.search);
      if (url.searchParams.get("userId") === "8") return result([
        { type: "ACTIVITY", id: 400, version: null, movable: false, title: "زيارة عميل في الإسكندرية", at: at(0, 14), endsAt: at(0, 15), kind: "MEETING", status: "PLANNED", recordType: null, recordId: null },
      ]);
      return result(items);
    }
    const command = path.match(/^\/workspace\/activities\/(\d+)\/(move|done|cancel)$/);
    if (command) {
      if (body.version !== 2) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ codeStatus: 409, error: { code: "CONFLICT", fields: [] } }) });
      return result({ id: Number(command[1]), version: 3 });
    }
    if (path === "/workspace/activities" && method === "POST") return result({ id: 500, version: 0 }, 201);
    if (path === "/workspace/search") return result([{ type: "OPPORTUNITY", id: 40, title: "توريد أنظمة جودة", subtitle: "O2880" }, { type: "VISIT", id: 7, title: "زيارة", subtitle: null }]);
    if (path === "/opportunities/40") return result({ id: 40, version: 6, name: "توريد أنظمة جودة" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, asked };
}

test("the week view places items by time, side by side when they overlap, with audits in the all-day row and a filter per kind", async ({ page }) => {
  await mockCalendar(page);
  await page.goto("/#/agenda");
  await expect(page.getByRole("heading", { name: "التقويم" })).toBeVisible();
  await expect(page.getByRole("button", { name: "أسبوع", exact: true })).toHaveAttribute("aria-pressed", "true");
  const todayCol = page.locator(".calendar-col.is-today");
  await expect(todayCol.locator(".calendar-event")).toHaveCount(3);
  await expect(todayCol.locator(".calendar-now")).toHaveCount(1);
  // the meeting (11–12) and the interview (11:30) overlap the session (9–13): three lanes, none hidden behind another
  const boxes = await todayCol.locator(".calendar-event").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  const lefts = new Set(boxes.map(b => Math.round(b[0])));
  expect(lefts.size).toBe(3);
  await expect(page.locator(".calendar-allday")).toContainText("تدقيق مخطط");
  // hide interviews, then bring them back
  const chip = page.locator(".calendar-legend").getByRole("button", { name: /مقابلة توظيف/ });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(todayCol.locator(".calendar-event")).toHaveCount(2);
  await chip.click();
  await expect(todayCol.locator(".calendar-event")).toHaveCount(3);
  // keyboard: M for month, D for day, T back to today; the chosen view is remembered
  await page.keyboard.press("m");
  await expect(page.locator(".calendar-month")).toBeVisible();
  await expect(page.locator(".calendar-month-day.is-today .calendar-item")).toHaveCount(3);
  await expect(page.locator(".calendar-month-day.is-today .calendar-more")).toHaveText("+1 كمان");
  await page.locator(".calendar-month-day.is-today .calendar-more").click();
  await expect(page.locator(".calendar-grid.is-day")).toBeVisible();
  await page.reload();
  await expect(page.locator(".calendar-grid.is-day")).toBeVisible();
});

test("a free time opens a new item there; linking it to a record sends the record's version, and it is planned when it is ahead", async ({ page }) => {
  const { posted } = await mockCalendar(page);
  await page.goto("/#/agenda");
  await page.getByRole("button", { name: "يوم", exact: true }).click();
  const col = page.locator(".calendar-col.is-today");
  await col.scrollIntoViewIfNeeded();
  // 22:00 today is a free slot: 22 hours down the column
  await page.locator(".calendar-scroll").evaluate(el => { el.scrollTop = 20 * 48; });
  const box = (await col.boundingBox())!;
  const top = await col.evaluate(el => el.getBoundingClientRect().top);
  await page.mouse.click(box.x + box.width / 2, top + 22 * 48 + 10);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("الساعة")).toHaveValue("22:00");
  await dialog.getByLabel("العنوان").fill("مكالمة متابعة العرض");
  await dialog.getByText("مكالمة", { exact: true }).click();
  await dialog.getByLabel("المدة").selectOption("45");
  await dialog.getByLabel("مرتبط بـ (اختياري)").fill("توريد");
  await dialog.getByRole("button", { name: /توريد أنظمة جودة/ }).click();
  await expect(dialog.getByRole("button", { name: /زيارة/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "إضافة" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".calendar-page").getByRole("status")).toContainText("اتضاف الموعد.");
  const saved = posted.find(p => p.path === "/workspace/activities")!;
  expect(saved.body).toMatchObject({ record: "OPPORTUNITY", recordId: 40, version: 6, kind: "CALL", subject: "مكالمة متابعة العرض", at: at(0, 22), minutes: 45, planned: true });
});

test("a personal item needs no record; the person's own planned item can be marked done, rescheduled or cancelled", async ({ page }) => {
  const { posted } = await mockCalendar(page);
  await page.goto("/#/agenda");
  await page.getByRole("button", { name: "موعد جديد" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("العنوان").fill("تجهيز عرض الإدارة");
  await dialog.getByRole("button", { name: "إضافة" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posted.find(p => p.path === "/workspace/activities")!.body).toMatchObject({ record: "SELF", subject: "تجهيز عرض الإدارة", kind: "MEETING", minutes: 30 });

  // done, with what came of it
  await page.locator(".calendar-event", { hasText: "اجتماع مراجعة العرض" }).focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "فتح السجل" })).toHaveAttribute("href", "#/opportunities/40");
  await dialog.getByRole("button", { name: "تم" }).click();
  await dialog.getByLabel("حصل إيه؟ (اختياري، مش بيتعرض تاني)").fill("وافقوا على النطاق");
  await dialog.locator("form").getByRole("button", { name: "تم" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posted.find(p => p.path === "/workspace/activities/300/done")!.body).toEqual({ version: 2, outcome: "وافقوا على النطاق" });

  // reschedule to tomorrow 10:15
  await page.locator(".calendar-event", { hasText: "اجتماع مراجعة العرض" }).focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "تغيير الميعاد" }).click();
  await dialog.getByLabel("اليوم").fill(at(1, 0).slice(0, 10));
  await dialog.getByLabel("الساعة").fill("10:15");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posted.find(p => p.path === "/workspace/activities/300/move")!.body).toMatchObject({ version: 2, at: at(1, 10, 15) });

  // cancel asks first
  await page.locator(".calendar-event", { hasText: "اجتماع مراجعة العرض" }).focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "إلغاء الموعد" }).click();
  await expect(dialog).toContainText("بيفضل في السجل كملغي");
  await dialog.getByRole("button", { name: "إلغاء الموعد" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posted.find(p => p.path === "/workspace/activities/300/cancel")!.body).toEqual({ version: 2 });

  // someone else's session opens read only: its record, no actions
  await page.locator(".calendar-event", { hasText: "دورة المراجع الداخلي" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "تغيير الميعاد" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "فتح السجل" })).toHaveAttribute("href", "#/training");
});

test("dragging your planned item down one hour moves it, snapped to the quarter hour", async ({ page }) => {
  const { posted } = await mockCalendar(page);
  await page.goto("/#/agenda");
  await page.getByRole("button", { name: "يوم", exact: true }).click();
  const item = page.locator(".calendar-event", { hasText: "اجتماع مراجعة العرض" });
  await item.scrollIntoViewIfNeeded();
  const box = (await item.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + i * 8 + 1);
  await page.mouse.up();
  await expect(page.locator(".calendar-page").getByRole("status")).toContainText("اتنقل الموعد.");
  expect(posted.find(p => p.path === "/workspace/activities/300/move")!.body).toMatchObject({ version: 2, at: at(0, 12) });
  // an item that is not yours to move does not move
  const session = page.locator(".calendar-event", { hasText: "دورة المراجع الداخلي" });
  await expect(session).not.toHaveClass(/is-movable/);
});

test("a teammate's calendar is read only: no new item, no dragging, and the server is asked for that person", async ({ page }) => {
  const { asked } = await mockCalendar(page, { people: [{ id: 7, name: "سارة منصور", me: true }, { id: 8, name: "كريم فؤاد", me: false }] });
  await page.goto("/#/agenda");
  await expect(page.getByRole("button", { name: "موعد جديد" })).toBeVisible();
  await page.getByLabel("تقويم مين").selectOption({ label: "كريم فؤاد" });
  await expect(page.locator(".calendar-page")).toContainText("بتشوف مواعيد زميل: للقراءة بس.");
  await expect(page.getByRole("button", { name: "موعد جديد" })).toHaveCount(0);
  await expect(page.locator(".calendar-event", { hasText: "زيارة عميل في الإسكندرية" })).not.toHaveClass(/is-movable/);
  expect(asked.some(q => q.includes("userId=8"))).toBe(true);
  await page.getByLabel("تقويم مين").selectOption({ label: "تقويمي" });
  await expect(page.getByRole("button", { name: "موعد جديد" })).toBeVisible();
});

test("the calendar passes axe's WCAG 2.1 A and AA rules in light and dark, week and month, and fits a phone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockCalendar(page);
  const found: Record<string, string[]> = {};
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(t => localStorage.setItem("ioeti.ui.preferences.v1", JSON.stringify({ theme: t, language: "ar", density: "comfortable", navigation: "expanded" })), theme);
    for (const view of ["أسبوع", "شهر", "قائمة"]) {
      await page.goto("/#/agenda");
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator(".calendar-legend")).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const issues = result.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 5).map(n => n.target.join(" ")).join(" | ")}`);
      if (issues.length) found[`${theme}/${view}`] = issues;
    }
  }
  expect(found).toEqual({});
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["أسبوع", "شهر"]) {
    await page.goto("/#/agenda");
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(".calendar-legend")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});

test("planned items whose time has passed stay in view above the calendar and can be postponed to tomorrow in one click", async ({ page }) => {
  const { posted } = await mockCalendar(page);
  await page.goto("/#/agenda");
  const late = page.locator(".calendar-late");
  await expect(late).toContainText("1 موعد فات ميعاده ومتعلّمتش إنها تمت");
  await late.getByRole("button", { name: /مكالمة متابعة مصنع الدلتا/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("متأخر");
  await dialog.getByRole("button", { name: "بكرة 10 الصبح" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".calendar-page").getByRole("status")).toContainText("اتأجل الموعد.");
  expect(posted.find(p => p.path === "/workspace/activities/290/move")!.body).toMatchObject({ version: 2, at: at(1, 10) });
});
