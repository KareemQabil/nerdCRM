import { expect, test, type Page, type Route } from "@playwright/test";

/** The app shell against a mocked API: the menu follows what the person may read, "+ New" from anywhere, and an ended session. */

const LEAD = { id: 301, version: 2, name: "هاني فؤاد", organization: "مطاحن الدلتا", stage: "To be processed", stageKind: "OPEN", businessLineCode: "ISO9001",
  assignedToMe: true, receivedAt: "2026-10-27T09:00:00", governorate: "CAIRO",
  response: { status: "NOT_SET", missing: "TARGET", dueAt: null, contactedAt: null, qualification: null, qualifyDueAt: null, qualifiedAt: null } };

async function mock(page: Page, options: { pages?: string[]; administrator?: boolean; expireAfterSession?: boolean } = {}) {
  let sessionCalls = 0;
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") {
      sessionCalls++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "sara", name: "سارة منصور", language: "ar",
        administrator: options.administrator ?? false, policyOwner: false, ...(options.pages ? { pages: options.pages } : {}) }) });
    }
    if (options.expireAfterSession && path === "/marketing/leads") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    if (path === "/business-lines" || path === "/business-lines/creatable") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if ((path === "/marketing/leads" || path === "/leads") && method === "GET") return result([LEAD]);
    if (path === "/leads/301") return result(LEAD);
    if (path === "/accounts" && method === "GET") return result([]);
    if (path === "/accounts/similar") return result([]);
    if (path === "/opportunities" && method === "GET") return result([]);
    if (path === "/marketing/sources" || path === "/marketing/campaigns" || path === "/marketing/saved-views") return result([]);
    if (path.startsWith("/workspace/agenda") || path.startsWith("/notifications")) return result([]);
    return result([]);
  });
  return { sessionCalls: () => sessionCalls };
}

test("the side menu offers only the pages whose records the person may read; the design and system pages are for administrators", async ({ page }) => {
  await mock(page, { pages: ["leads", "accounts"] });
  await page.goto("/#/agenda");
  const nav = page.locator(".side-panel");
  await expect(nav.getByRole("button", { name: "العملاء المحتملون" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "حسابات العملاء" })).toBeVisible();
  for (const hidden of ["الفرص التجارية", "الحملات", "الجودة", "الشهادات", "التوظيف", "التمويل"]) await expect(nav.getByRole("button", { name: hidden, exact: true })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /نظام التصميم|خريطة/ })).toHaveCount(0);
  // "+ New" offers only what can be opened
  await page.getByRole("button", { name: "جديد", exact: true }).click();
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items).toHaveText([/عميل محتمل جديد/, /حساب جديد/, /موعد جديد/]);
});

test("\"+ New\" starts a record from any page: the account form opens on the accounts page, and N then L opens the lead intake", async ({ page }) => {
  await mock(page);
  await page.goto("/#/agenda");
  await page.getByRole("button", { name: "جديد", exact: true }).click();
  await page.getByRole("menuitem", { name: /حساب جديد/ }).click();
  await expect(page).toHaveURL(/#\/accounts$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("اسم الشركة")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("n");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(page.locator(".mk-intake")).toBeVisible();
});

test("the leads list names the business line, and a lead's stage is shown in Arabic", async ({ page }) => {
  await mock(page);
  await page.goto("/#/leads");
  const row = page.locator("tr", { hasText: "هاني فؤاد" });
  await expect(row).toContainText("أيزو 9001");
  await expect(row).not.toContainText("ISO9001");
  await page.goto("/#/leads/301");
  await expect(page.locator("main")).not.toContainText("To be processed");
});

test("when the session ends, the next request returns to sign-in and says why", async ({ page }) => {
  await mock(page, { expireAfterSession: true });
  await page.goto("/#/leads");
  await expect(page.getByRole("alert")).toContainText("انتهت الجلسة. سجّل الدخول تاني عشان تكمل.");
  await expect(page.getByLabel(/اسم المستخدم|المستخدم/).first()).toBeVisible();
});

test("a success notice carries no technical code; a failure keeps a short support reference", async ({ page }) => {
  await mock(page);
  await page.goto("/#/agenda");
  await page.evaluate(async () => {
    const notices = await import("/src/feedback.ts");
    notices.notifyApiSuccess("POST", 201);
  });
  const ok = page.getByRole("status").filter({ hasText: "تم إنشاء السجل" });
  await expect(ok).toBeVisible();
  await expect(ok).not.toContainText("HTTP");
  await page.evaluate(async () => {
    const notices = await import("/src/feedback.ts");
    notices.notifyApiFailure({ statusCode: 409, code: "STALE_WRITE", message: "x" });
  });
  const failed = page.getByRole("status").filter({ hasText: "STALE_WRITE" });
  await expect(failed).toContainText("مرجع للدعم");
  await expect(failed).not.toContainText("HTTP");
});
