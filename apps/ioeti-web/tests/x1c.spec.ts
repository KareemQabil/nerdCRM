import { expect, test, type Page, type Route } from "@playwright/test";

/** X1c against a mocked API: day-one readiness on Home, one-tap follow-up times, and phone lists that read as cards. */

const LEAD = { id: 301, version: 2, name: "هاني فؤاد", organization: "مطاحن الدلتا", stage: "To be processed", stageKind: "OPEN", businessLineCode: "ISO9001",
  assignedToMe: true, receivedAt: "2026-10-27T09:00:00", governorate: "CAIRO",
  response: { status: "NOT_SET", missing: "TARGET", dueAt: null, contactedAt: null, qualification: null, qualifyDueAt: null, qualifiedAt: null } };
const policy = (key: string, titleAr: string, inForce: number) => ({ key, decision: "D-06", area: "FINANCE", scope: "BUSINESS_LINE", allowsDefault: true,
  titleAr, titleEn: key, helpAr: "", helpEn: "", inForce });

async function mock(page: Page, options: { administrator?: boolean; policyOwner?: boolean; noOwners?: boolean; set?: number } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    if (method === "POST") posted.push({ path, body: (route.request().postDataJSON() as Record<string, unknown>) ?? {} });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "admin", name: "مدير النظام",
      language: "ar", administrator: options.administrator ?? false, policyOwner: options.policyOwner ?? false }) });
    if (path === "/policies") {
      const all = [policy("finance.tax", "ضريبة الخدمات", 0), policy("finance.payment-terms", "شروط السداد", 0), policy("sales.quote-validity", "صلاحية عرض السعر", 0),
        policy("sales.quote-approval", "موافقة عروض الأسعار", 0), policy("leads.routing", "توزيع العملاء", 0), policy("work.calendar", "أيام العمل", 0)];
      (options.set ? all.slice(0, options.set) : []).forEach(p => { p.inForce = 1; });
      return result({ canEdit: !!options.policyOwner, noOwners: !!options.noOwners, policies: all });
    }
    if (path.startsWith("/reports") || path.startsWith("/operations") || path.startsWith("/workspace/reviews")) return result(null, 403);
    if (path === "/business-lines" || path === "/business-lines/creatable") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if ((path === "/marketing/leads" || path === "/leads") && method === "GET") return result([LEAD]);
    if (path === "/leads/301") return result(LEAD);
    return result([]);
  });
  return { posted };
}

test("an administrator with no policy owner yet is told why steps are closed and where to start", async ({ page }) => {
  await mock(page, { administrator: true, noOwners: true });
  await page.goto("/#/home");
  const card = page.getByRole("region", { name: "جاهزية التشغيل" });
  await expect(card).toContainText("لسه مفيش مسؤول عن قواعد العمل");
  await card.getByRole("button", { name: "ظبط قواعد العمل" }).click();
  await expect(page).toHaveURL(/#\/policies/);
});

test("a policy owner sees how many rules are set and the first missing ones; once all are set the card is gone", async ({ page }) => {
  await mock(page, { policyOwner: true, set: 2 });
  await page.goto("/#/home");
  const card = page.getByRole("region", { name: "جاهزية التشغيل" });
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  await expect(card).toContainText("2 من 6 قاعدة متظبطة");
  await expect(card).toContainText("صلاحية عرض السعر");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mock(page, { policyOwner: true, set: 6 });
  await page.reload();
  await expect(page.getByRole("heading", { name: /مرحبًا/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "جاهزية التشغيل" })).toHaveCount(0);
});

test("a salesperson without rights to the rules never sees the readiness card", async ({ page }) => {
  await mock(page, { noOwners: true });
  await page.goto("/#/home");
  await expect(page.getByRole("heading", { name: /مرحبًا/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "جاهزية التشغيل" })).toHaveCount(0);
});

test("on a phone the lead list reads as cards with labels, and the filters fold behind one button that counts them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/#/leads");
  const row = page.locator(".data-table tbody tr").first();
  await expect(row).toBeVisible();
  await expect(page.locator(".data-table thead")).toHaveCSS("position", "absolute");
  await expect(row.locator("td").nth(1)).toHaveAttribute("data-label", /.+/);
  const filters = page.locator("details.phone-filters");
  await expect(filters).not.toHaveAttribute("open", "");
  await filters.locator("summary").click();
  await page.getByLabel("فقط المكلّفون بي").or(page.getByText("المكلّفون بي فقط")).first().check();
  await expect(filters.locator(".phone-filters-count")).toHaveText("1");
});

