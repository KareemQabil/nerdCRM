import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * M1 (D-05): finance issues donation receipts on recorded collections and maps restrictions to analytic accounts, against a
 * mocked API. The live API is covered by scripts/fundraising_probe.py.
 */

type Json = Record<string, unknown>;
type Posted = { method: string; path: string; body: Json };

const opp = { id: 31, version: 4, reference: "GR-NILE", donorId: 21, donorName: "Nile Delta Foundation", title: "STEM scholarships for girls",
  purpose: "Scholarships", kind: "GRANT", stage: "APPROVED", proposedAmount: "500000.00", currency: "EGP", deadline: null, campaignId: null,
  campaignName: null, renewalOf: null, commitmentId: 41, archived: false, managedByMe: true };

async function mock(page: Page, options: { finance?: boolean; analyticDenied?: boolean; receiptAnswer?: { status: number; code: string } } = {}) {
  const finance = options.finance ?? true;
  const posted: Posted[] = [];
  const s = {
    commitVersion: 5, restriction: null as Json | null,
    collections: [{ id: 70, version: 1, amount: "100000.00", receivedOn: "2026-10-16", status: "RECORDED", voidReason: null, recordedBy: "Hana",
      receiptStatus: "NOT_ISSUED", receiptId: null, receiptNumber: null, voidedReceipts: 0, canIssueReceipt: finance,
      allocationStatus: "PENDING_ALLOCATION", analyticAccount: null }] as Json[],
    receipts: [] as Json[],
    restrictions: [{ id: 3, version: 0, code: "GIRLS-STEM", name: "Girls' STEM scholarships", analyticAccountId: 801, analyticAccountCode: "AN-STEM",
      analyticAccountName: "STEM programme", active: true }] as Json[],
  };
  const commitment = () => ({ id: 41, version: s.commitVersion, opportunityId: 31, reference: "GR-NILE", title: "STEM scholarships for girls",
    donorName: "Nile Delta Foundation", currency: "EGP", committed: 400000, scheduled: 150000, collected: 100000, outstanding: 300000, unscheduled: 250000,
    restricted: true, restrictionPurpose: "Girls' STEM scholarships", agreementReference: "AGR-7", approvedOn: "2026-10-01", periodEnd: null,
    pendingDeliverables: 0, accountingStatus: "NOT_POSTED", managedByMe: true,
    allocationStatus: s.restriction ? "ALLOCATED" : "PENDING_ALLOCATION", fundRestrictionId: s.restriction?.id ?? null,
    fundRestrictionCode: s.restriction?.code ?? null, fundRestrictionName: s.restriction?.name ?? null,
    analyticAccount: s.restriction ? "AN-STEM - STEM programme" : null, canAllocate: finance && !s.restriction, canIssueReceipts: finance });
  const receipt = (id: number, number: string, extra: Json = {}): Json => ({ id, version: 0, number, status: "ISSUED", collectionId: 70, opportunityId: 31,
    reference: "GR-NILE", title: "STEM scholarships for girls", donorName: "Nile Delta Foundation", amount: "100000.00", currency: "EGP",
    receivedOn: "2026-10-16", issuedOn: "2026-10-27", issuedBy: "Mona Finance", restrictedTo: "Girls' STEM scholarships", voidReason: null,
    voidedAt: null, replacesNumber: null, canVoid: finance, ...extra });
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti\/fundraising/, "").replace(/^.*\/ws\/ioeti/, "") + url.search;
    const method = route.request().method();
    const body = (method === "POST" || method === "PUT") ? (route.request().postDataJSON() as Json) ?? {} : {};
    if (method !== "GET") posted.push({ method, path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    const failure = (code: number, error: string) => route.fulfill({ status: code, contentType: "application/json",
      body: JSON.stringify({ codeStatus: code, error: { code: error, message: "raw server text", correlationId: "c0ffee11", fields: [] } }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "mona", name: "منى", language: "ar" }) });
    if (path === "/business-lines") return result([]);
    if (path === "/opportunities/31") return result(opp);
    if (path === "/commitments/41") return result(commitment());
    if (path === "/commitments/41/installments") return result([{ id: 50, version: 2, sequence: 1, dueDate: "2026-11-15", amount: 150000, collected: 100000, status: "PARTIAL" }]);
    if (path === "/commitments/41/deliverables") return result([]);
    if (path === "/installments/50/collections") return result(s.collections);
    if (path === "/fund-restrictions" && method === "GET") return finance ? result(s.restrictions) : failure(403, "FORBIDDEN");
    if (path === "/fund-restrictions") {
      const r = { id: 4, version: 0, code: body.code, name: body.name, analyticAccountId: body.analyticAccountId, analyticAccountCode: "AN-WATER",
        analyticAccountName: "Clean water", active: true };
      s.restrictions.push(r); return result(r, 201);
    }
    if (path.startsWith("/analytic-accounts")) return options.analyticDenied ? failure(403, "FORBIDDEN")
      : result([{ id: 801, code: "AN-STEM", name: "STEM programme" }, { id: 802, code: "AN-WATER", name: "Clean water" }]);
    if (path === "/restricted-funds") return result([
      { restrictionId: 3, code: "GIRLS-STEM", name: "Girls' STEM scholarships", analyticAccountCode: "AN-STEM", analyticAccountName: "STEM programme",
        currency: "EGP", committed: 400000, collected: 100000, commitments: 1, allocated: true },
      { restrictionId: null, code: null, name: null, analyticAccountCode: null, analyticAccountName: null, currency: "USD", committed: 20000,
        collected: 5000, commitments: 1, allocated: false }]);
    if (path === "/commitments/41/allocate") {
      s.restriction = s.restrictions.find(r => r.id === body.restrictionId)!; s.commitVersion++;
      s.collections = s.collections.map(k => ({ ...k, allocationStatus: "ALLOCATED", analyticAccount: "AN-STEM - STEM programme" }));
      return result(commitment());
    }
    if (path === "/collections/70/receipt") {
      if (options.receiptAnswer) return failure(options.receiptAnswer.status, options.receiptAnswer.code);
      const previous = s.receipts.at(-1);
      const r = receipt(500 + s.receipts.length, `DR-2026-00000${s.receipts.length + 1}`, previous ? { replacesNumber: previous.number } : {});
      s.receipts.push(r);
      s.collections = s.collections.map(k => ({ ...k, receiptStatus: "ISSUED", receiptId: r.id, receiptNumber: r.number, canIssueReceipt: false }));
      return result(r, 201);
    }
    const one = path.match(/^\/receipts\/(\d+)$/);
    if (one) return result(s.receipts.find(r => r.id === Number(one[1])));
    const voiding = path.match(/^\/receipts\/(\d+)\/void$/);
    if (voiding) {
      const r = s.receipts.find(x => x.id === Number(voiding[1]))!;
      Object.assign(r, { status: "VOIDED", voidReason: body.reason, version: 1, canVoid: false, voidedAt: "2026-10-27T11:00:00" });
      s.collections = s.collections.map(k => ({ ...k, receiptStatus: "NOT_ISSUED", receiptId: null, receiptNumber: null, voidedReceipts: 1, canIssueReceipt: true }));
      return result(r);
    }
    return result([]);
  });
  return { posted, s };
}

test("finance allocates a restricted grant to its restriction, then issues, voids and reissues a receipt with a new number", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/fundraising/opportunities/31");
  const allocation = page.locator(".fund-allocation");
  await expect(allocation).toContainText("مستني تخصيص من المالية");
  await allocation.getByLabel("قيد التمويل").selectOption("3");
  await allocation.getByRole("button", { name: "تخصيص لقيد التمويل" }).click();
  await expect(allocation).toContainText("Girls' STEM scholarships");
  await expect(allocation).toContainText("AN-STEM - STEM programme");
  expect(posted.find(p => p.path === "/commitments/41/allocate")!.body).toEqual({ version: 5, restrictionId: 3 });
  // a recorded collection: finance issues its receipt
  await page.locator(".fund-installment-head").first().click();
  const inst = page.locator(".fund-installment").first();
  await expect(inst.locator(".fund-analytic")).toHaveText("AN-STEM - STEM programme");
  await inst.getByRole("button", { name: "إصدار إيصال تبرع" }).click();
  await expect(page).toHaveURL(/#\/fundraising\/receipts\/500$/);
  const sheet = page.locator(".fund-receipt-print");
  await expect(sheet.getByRole("heading", { name: "إيصال تبرع" })).toBeVisible();
  await expect(sheet).toContainText("DR-2026-000001");
  await expect(sheet).toContainText("Nile Delta Foundation");
  await expect(sheet).toContainText("100,000.00 EGP");
  await expect(sheet).toContainText("Girls' STEM scholarships");
  await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
  // void with a reason: the number stays, a reissue gets a new number that names the one it replaces
  await page.getByLabel("إلغاء الإيصال").selectOption("WRONG_DONOR_DETAILS");
  await page.getByRole("button", { name: "إلغاء الإيصال" }).click();
  await expect(page.locator(".fund-receipt-stamp")).toContainText("بيانات المتبرع غلط");
  await expect(sheet).toContainText("DR-2026-000001");
  await page.getByRole("button", { name: "إصدار إيصال جديد" }).click();
  await expect(page).toHaveURL(/#\/fundraising\/receipts\/501$/);
  await expect(sheet).toContainText("DR-2026-000002");
  await expect(sheet).toContainText("DR-2026-000001");
  expect(posted.filter(p => /receipt/.test(p.path)).map(p => [p.path, p.body])).toEqual([
    ["/collections/70/receipt", {}], ["/receipts/500/void", { version: 0, reason: "WRONG_DONOR_DETAILS" }], ["/collections/70/receipt", {}]]);
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("a fundraiser without finance rights sees the allocation waiting for finance and no receipt or allocation actions", async ({ page }) => {
  const { posted } = await mock(page, { finance: false });
  await page.goto("/#/fundraising/opportunities/31");
  await expect(page.locator(".fund-allocation")).toContainText("مستني تخصيص من المالية");
  await expect(page.getByRole("button", { name: "تخصيص لقيد التمويل" })).toHaveCount(0);
  await expect(page.locator(".fund-note").filter({ hasText: "المالية بس هي اللي بتصدر إيصال التبرع" })).toBeVisible();
  for (const label of ["إصدار فاتورة", "ترحيل للحسابات"]) await expect(page.getByRole("button", { name: label })).toBeDisabled();
  await page.locator(".fund-installment-head").first().click();
  await expect(page.locator(".fund-installment").first()).toContainText("مستني تخصيص من المالية");
  await expect(page.getByRole("button", { name: "إصدار إيصال تبرع" })).toHaveCount(0);
  expect(posted).toEqual([]);
});

test("a second receipt for the same collection is refused plainly", async ({ page }) => {
  await mock(page, { receiptAnswer: { status: 409, code: "RECEIPT_EXISTS" } });
  await page.goto("/#/fundraising/opportunities/31");
  await page.locator(".fund-installment-head").first().click();
  await page.getByRole("button", { name: "إصدار إيصال تبرع" }).click();
  await expect(page.getByRole("alert")).toHaveText(/فيه إيصال ساري للتحصيل ده بالفعل/);
  await expect(page).toHaveURL(/#\/fundraising\/opportunities\/31$/);
});

test("restricted funds: balance per restriction and currency, unallocated apart; finance maps a restriction to an analytic account", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/fundraising/restricted");
  const table = page.locator(".fund-rf-table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("tbody tr").first()).toContainText("Girls' STEM scholarships");
  await expect(table.locator("tbody tr").first()).toContainText("AN-STEM - STEM programme");
  await expect(table.locator("tbody tr").first()).toContainText("100,000.00 EGP");
  await expect(table.locator(".fund-rf-unallocated")).toContainText("تمويل مقيّد مستني تخصيص");
  await expect(table.locator(".fund-rf-unallocated")).toContainText("5,000.00 USD");
  await expect(page.locator(".fund-note").filter({ hasText: "الترحيل لدفتر الأستاذ لسه مش متاح" })).toBeVisible();
  await page.getByLabel("الكود").fill("water-2027");
  await page.getByLabel("الاسم", { exact: true }).fill("Clean water wells");
  await page.locator("form.fund-form").getByLabel("الحساب التحليلي").selectOption("802");
  await page.getByRole("button", { name: "قيد جديد" }).click();
  await expect(page.locator(".fund-list")).toContainText("Clean water wells");
  expect(posted.find(p => p.path === "/fund-restrictions")!.body).toEqual({ code: "WATER-2027", name: "Clean water wells", analyticAccountId: 802 });
});

test("restricted funds: without access to analytic accounts the mapping form is not offered", async ({ page }) => {
  await mock(page, { analyticDenied: true });
  await page.goto("/#/fundraising/restricted");
  await expect(page.locator(".fund-rf-table")).toBeVisible();
  await expect(page.getByRole("button", { name: "قيد جديد" })).toHaveCount(0);
});

test("receipt page: no horizontal scroll on a phone and no serious accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/#/fundraising/opportunities/31");
  await page.locator(".fund-installment-head").first().click();
  await page.getByRole("button", { name: "إصدار إيصال تبرع" }).click();
  await expect(page.locator(".fund-receipt-print")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const scan = await new AxeBuilder({ page }).include(".fund-record").analyze();
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id)).toEqual([]);
});
