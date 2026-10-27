import { expect, test, type Page, type Route } from "@playwright/test";

/** The pipeline board and the complete new-opportunity form against a mocked API; the live API is in daily_work_probe.py. */

type Posted = { path: string; body: Record<string, unknown> };
const STAGES = [{ id: 1, name: "New", kind: "OPEN" }, { id: 2, name: "Qualification", kind: "OPEN" }, { id: 3, name: "Proposition", kind: "OPEN" },
  { id: 4, name: "Closed won", kind: "WON" }, { id: 5, name: "Closed lost", kind: "LOST" }];
const opp = (id: number, name: string, stageId: number, amount: string, extra: Record<string, unknown> = {}) => {
  const stage = STAGES.find(s => s.id === stageId)!;
  return { id, version: 3, name, reference: "O" + id, businessLineCode: "ISO9001", businessLineNameAr: "أيزو 9001", businessLineNameEn: "ISO 9001",
    stage: stage.name, stageId, stageKind: stage.kind, amount, currencyCode: "EGP", expectedCloseDate: "2026-12-15", probability: 40, lostReason: null, ...extra };
};

async function mock(page: Page, extra = 0) {
  const posted: Posted[] = [];
  const board = [
    { opportunity: opp(40, "توريد أنظمة جودة", 1, "120000"), accountName: "شركة الأمل للتجارة", accountId: 31, ownerName: "سارة منصور", mine: true },
    { opportunity: opp(41, "تدريب المراجعين الداخليين", 1, "30000", { expectedCloseDate: "2026-01-10" }), accountName: "مصنع النور", accountId: 32, ownerName: "سارة منصور", mine: true },
    { opportunity: opp(42, "شهادة أيزو 14001", 2, "80000"), accountName: null, accountId: null, ownerName: "كريم فؤاد", mine: false },
    { opportunity: opp(43, "شهادة سلامة الغذاء", 4, "50000"), accountName: "مطاعم الدلتا", accountId: 33, ownerName: "سارة منصور", mine: true },
  ];
  for (let i = 0; i < extra; i++) board.push({ opportunity: opp(1000 + i, "فرصة " + i, 1, "1000"), accountName: null, accountId: null, ownerName: "كريم فؤاد", mine: false });
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) ?? {} : {};
    if (method === "POST") posted.push({ path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "sara", name: "سارة منصور", language: "ar", administrator: false }) });
    if (path === "/business-lines" || path === "/business-lines/creatable") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if (path === "/opportunities/board") return result(board);
    if (path === "/opportunities/stages") return result(STAGES);
    if (path === "/opportunities" && method === "GET") return result(board.map(c => c.opportunity));
    if (path === "/opportunities" && method === "POST") return result(opp(90, String(body.name), 1, String(body.amount ?? "0"), { version: 0 }), 201);
    const stage = path.match(/^\/opportunities\/(\d+)\/stage$/);
    if (stage) {
      const card = board.find(c => c.opportunity.id === Number(stage[1]))!;
      card.opportunity = { ...opp(card.opportunity.id, card.opportunity.name, Number(body.stageId), card.opportunity.amount), version: 4 };
      return result(card.opportunity);
    }
    const one = path.match(/^\/opportunities\/(\d+)$/);
    if (one) return result(Number(one[1]) === 90 ? opp(90, "عقد صيانة سنوي", 1, "45000", { version: 1 }) : board.find(c => c.opportunity.id === Number(one[1]))?.opportunity);
    if (path === "/workspace/search") return result([{ type: "ACCOUNT", id: 31, title: "شركة الأمل للتجارة", subtitle: "P1070" }, { type: "LEAD", id: 5, title: "الأمل", subtitle: null }]);
    if (path === "/workspace/account360/31") return result({ id: 31, name: "شركة الأمل للتجارة", sections: [], money: [] });
    if (path === "/accounts" && method === "GET") return result([{ id: 31, version: 2, name: "شركة الأمل للتجارة", reference: "P1070", customer: true, prospect: false }]);
    if (path === "/accounts/31") return result({ id: 31, version: 2, name: "شركة الأمل للتجارة", reference: "P1070", customer: true, prospect: false });
    return result([]);
  });
  return { posted };
}

test("the board shows each open stage with its count and total, then won; a late close date stands out", async ({ page }) => {
  await mock(page);
  await page.goto("/#/opportunities");
  await page.getByRole("button", { name: "لوحة", exact: true }).click();
  const columns = page.locator(".pipeline-column");
  await expect(columns).toHaveCount(5); // three open stages, won, lost
  await expect(columns.nth(0).locator(".pipeline-count")).toHaveText("2");
  await expect(columns.nth(0).locator(".pipeline-sum")).toContainText("150,000 EGP");
  await expect(columns.nth(0)).toContainText("شركة الأمل للتجارة");
  await expect(columns.nth(0).locator(".is-late")).toHaveCount(1);
  await expect(columns.nth(1)).toContainText("كريم فؤاد"); // someone else's: the owner is named
  await expect(columns.nth(3)).toContainText("شهادة سلامة الغذاء");
  // the choice is remembered
  await page.reload();
  await expect(page.locator(".pipeline-board")).toBeVisible();
  // filters: mine only hides Karim's
  await page.getByLabel("فرصي بس").check();
  await expect(columns.nth(1).locator(".pipeline-card")).toHaveCount(0);
});

test("a card moves between open stages by dragging or from its own list, with its version; won opens the record instead", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/opportunities");
  await page.getByRole("button", { name: "لوحة", exact: true }).click();
  const columns = page.locator(".pipeline-column");
  await columns.nth(0).locator(".pipeline-card", { hasText: "توريد أنظمة جودة" }).dragTo(columns.nth(2));
  await expect(page.locator(".pipeline-board-wrap").getByRole("status")).toContainText("اتنقلت الفرصة.");
  expect(posted.find(p => p.path === "/opportunities/40/stage")!.body).toEqual({ version: 3, stageId: 3 });
  await expect(columns.nth(2)).toContainText("توريد أنظمة جودة");
  // the keyboard way: the card's own stage list
  await columns.nth(0).getByLabel("نقل إلى: تدريب المراجعين الداخليين").selectOption({ index: 1 });
  await expect.poll(() => posted.filter(p => p.path === "/opportunities/41/stage").length).toBe(1);
  // won needs the line's evidence: the record opens, nothing is posted
  await columns.nth(1).getByLabel("نقل إلى: شهادة أيزو 14001").selectOption({ label: "مكسوبة (آخر 30 يوم)" });
  await expect(page).toHaveURL(/#\/opportunities\/42$/);
  expect(posted.some(p => p.path === "/opportunities/42/stage")).toBe(false);
});

test("a new opportunity can carry its account and estimate at once, and opens straight away", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/opportunities");
  await page.getByRole("button", { name: "فرصة جديدة" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "اسم الفرصة" }).fill("عقد صيانة سنوي");
  await dialog.getByPlaceholder("اكتب حرفين من اسم الحساب").fill("الأمل");
  await dialog.getByRole("button", { name: /شركة الأمل للتجارة/ }).click();
  await expect(dialog.getByRole("button", { name: /^الأمل/ })).toHaveCount(0); // leads are not offered as accounts
  await dialog.getByLabel("القيمة المتوقعة").fill("45000");
  await dialog.getByLabel("الإغلاق المتوقع").fill("2026-12-31");
  await dialog.getByLabel("الاحتمال %").fill("60");
  await expect(dialog.getByRole("button", { name: "إلغاء" })).toBeVisible();
  await dialog.getByRole("button", { name: "إنشاء الفرصة" }).click();
  await expect(page).toHaveURL(/#\/opportunities\/90$/);
  expect(posted.find(p => p.path === "/opportunities")!.body).toEqual({ name: "عقد صيانة سنوي", businessLineCode: "ISO9001", accountId: 31,
    amount: "45000", currencyCode: "EGP", expectedCloseDate: "2026-12-31", probability: "60" });
});

test("an account starts its own opportunity: the form opens with the account filled in", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/accounts/31");
  await page.getByRole("button", { name: "فرصة جديدة للحساب ده" }).click();
  await expect(page).toHaveURL(/#\/opportunities$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".calendar-linked")).toContainText("شركة الأمل للتجارة");
  await dialog.getByRole("textbox", { name: "اسم الفرصة" }).fill("تجديد الشهادة");
  await dialog.getByRole("button", { name: "إنشاء الفرصة" }).click();
  await expect.poll(() => posted.find(p => p.path === "/opportunities")?.body).toMatchObject({ accountId: 31, name: "تجديد الشهادة" });
});

test("a board at the server's cap says its totals cover the shown cards only and points to the sales report", async ({ page }) => {
  await mock(page);
  await page.goto("/#/opportunities");
  await page.getByRole("button", { name: "لوحة", exact: true }).click();
  await expect(page.locator(".pipeline-column")).toHaveCount(5);
  await expect(page.getByText("الإجماليات للي ظاهر بس")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mock(page, 496);
  await page.reload();
  await page.getByRole("button", { name: "لوحة", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "اللوحة بتعرض أول 500 فرصة" })).toBeVisible();
});
