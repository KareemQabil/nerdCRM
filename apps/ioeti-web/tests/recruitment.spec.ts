import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * M1 (D-04): placement fees, the guarantee and early exits under the client agreement, against a mocked API.
 * The live API is covered by scripts/recruitment_probe.py.
 */

type Json = Record<string, unknown>;
type Posted = { method: string; path: string; body: Json };

const placementBase = (extra: Json = {}): Json => ({
  id: 95, version: 3, applicationId: 71, jobOrderId: 41, jobOrderReference: "JO-NILE", clientName: "Nile Hotels", candidateName: "Salma Hassan",
  startDate: "2026-09-01", startedOn: "2026-09-01", guaranteeStatus: "ACTIVE", feeMilestones: ["OFFER_ACCEPTED", "CANDIDATE_STARTED"],
  invoicingStatus: "REQUESTED", feeAmount: "36000.00", feeCurrency: "EGP", feePercent: 15, invoiceOn: "START_DATE",
  feeRequestedAt: "2026-09-01T09:00:00", guaranteeDays: 90, guaranteeEndsOn: "2026-11-30", guaranteeDaysLeft: 34, replacementRule: "REPLACE",
  refundPercent: null, exitedOn: null, exitReason: null, exitOutcome: null, refundStatus: null, refundAmount: null, replacementOfId: null,
  feeWaived: false, offerTermsOnFile: true, canEdit: true, ...extra,
});

async function mock(page: Page, placement: Json, options: { feeAnswer?: { status: number; code: string }; exitOutcome?: Json } = {}) {
  const posted: Posted[] = [];
  const state = { placement: { ...placement }, app: { id: 71, version: 6, jobOrderId: 41, candidateId: 51, candidateName: "Salma Hassan",
    candidateHeadline: "Front office supervisor", stage: "PLACED", submittedAt: "2026-08-01T10:00:00", offerDate: "2026-08-20", offerStatus: "ACCEPTED",
    consentOnFile: true, offerTermsOnFile: placement.offerTermsOnFile !== false } as Json };
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const body = (method === "POST" || method === "PUT") ? (route.request().postDataJSON() as Json) ?? {} : {};
    if (method !== "GET") posted.push({ method, path, body });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    const failure = (code: number, error: string) => route.fulfill({ status: code, contentType: "application/json",
      body: JSON.stringify({ codeStatus: code, error: { code: error, message: "raw server text", correlationId: "c0ffee10", fields: [] } }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "rana", name: "رنا", language: "ar" }) });
    if (path === "/business-lines") return result([]);
    if (path === "/recruitment/placements/95" && method === "GET") return result(state.placement);
    if (path === "/recruitment/job-orders/41") return result({ id: 41, version: 4, reference: "JO-NILE", clientId: 901, clientName: "Nile Hotels",
      title: "Front Office Manager", headcount: 1, location: "Cairo", requirements: null, status: "FILLED", activeCandidates: 0, placed: 1,
      recruitedByMe: true, recruiterName: "Rana" });
    if (path === "/recruitment/job-orders/41/applications") return result([state.app]);
    if (path === "/recruitment/job-orders/41/placements") return result([state.placement]);
    if (path.startsWith("/recruitment/candidates")) return result([]);
    if (path === "/recruitment/applications/71/interviews") return result([]);
    if (path === "/recruitment/applications/71/offer-terms") {
      state.app = { ...state.app, version: (state.app.version as number) + 1, offerTermsOnFile: true };
      state.placement = { ...state.placement, offerTermsOnFile: true, invoicingStatus: "NOT_DUE" };
      return result(state.app);
    }
    if (path === "/recruitment/placements/95/invoice") return options.feeAnswer ? failure(options.feeAnswer.status, options.feeAnswer.code) : result(state.placement);
    if (path === "/recruitment/placements/95/started") {
      state.placement = { ...state.placement, startedOn: body.startedOn, feeMilestones: ["OFFER_ACCEPTED", "CANDIDATE_STARTED"], version: 4 };
      return result(state.placement);
    }
    if (path === "/recruitment/placements/95/early-exit") {
      state.placement = { ...state.placement, version: 4, exitedOn: body.exitedOn, exitReason: body.reason, guaranteeStatus: "EARLY_EXIT",
        guaranteeDaysLeft: null, ...(options.exitOutcome ?? { exitOutcome: "REPLACEMENT_OPENED" }) };
      return result(state.placement);
    }
    return result([]);
  });
  return { posted, state };
}

test("placement: the fee went to finance under the client agreement; the guarantee counts down; an early exit opens a free replacement", async ({ page }) => {
  const { posted } = await mock(page, placementBase());
  await page.goto("/#/recruitment/placements/95");
  await expect(page.getByRole("heading", { name: "Salma Hassan", level: 1 })).toBeVisible();
  const fee = page.locator(".rec-fee-card");
  await expect(fee).toContainText("اتبعت للمالية");
  await expect(fee).toContainText("36,000.00 EGP");
  await expect(fee).toContainText("15%");
  await expect(fee).toContainText("استلام الشغل");
  const guarantee = page.locator(".rec-guarantee-card");
  await expect(guarantee.locator(".rec-countdown strong")).toHaveText("34");
  await expect(guarantee).toContainText("90 يوم");
  await expect(guarantee).toContainText("بديل مجاني");
  // the dialog says what will happen for the chosen date, before anything is recorded
  await page.getByRole("button", { name: "تسجيل ترك المرشح للشغل" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ساب يوم").fill("2026-12-15");
  await expect(dialog.locator(".rec-will")).toContainText("بعد آخر يوم في الضمان");
  await dialog.getByLabel("ساب يوم").fill("2026-10-20");
  await expect(dialog.locator(".rec-will")).toContainText("طلب التوظيف هيتفتح تاني لبديل مجاني");
  await dialog.getByLabel("السبب").selectOption("RESIGNED");
  await dialog.getByRole("button", { name: "تسجيل الترك" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(guarantee).toContainText("اتفتح طلب بديل مجاني");
  await expect(page.locator(".record-tags")).toContainText("ساب في الضمان");
  expect(posted.find(p => p.path.endsWith("/early-exit"))!.body).toEqual({ version: 3, exitedOn: "2026-10-20", reason: "RESIGNED" });
  await expect(page.getByRole("button", { name: "تسجيل ترك المرشح للشغل" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("placement: without the client agreement the page says which policy is missing; asking for the fee is refused plainly", async ({ page }) => {
  const { posted } = await mock(page, placementBase({ invoicingStatus: "POLICY_NOT_SET", guaranteeStatus: "TERMS_PENDING", feeAmount: null,
    feeCurrency: null, feePercent: null, invoiceOn: null, feeRequestedAt: null, guaranteeDays: null, guaranteeEndsOn: null, guaranteeDaysLeft: null,
    replacementRule: null }), { feeAnswer: { status: 422, code: "POLICY_NOT_SET" } });
  await page.goto("/#/recruitment/placements/95");
  const fee = page.locator(".rec-fee-card");
  await expect(fee).toContainText("اتفاقية العميل مش مضبوطة");
  await expect(fee.locator(".rec-why")).toContainText("recruitment.agreement");
  await expect(fee.getByRole("link", { name: "صفحة السياسات" })).toHaveAttribute("href", "#/policies");
  await expect(page.locator(".rec-guarantee-card")).toContainText("مستني اتفاقية العميل");
  await page.getByRole("button", { name: "طلب الأتعاب من المالية" }).click();
  await expect(page.getByRole("alert")).toHaveText(/اتفاقية التوظيف للعميل ده مش مضبوطة/);
  expect(posted.map(p => p.path)).toEqual(["/recruitment/placements/95/invoice"]);
  await expect(page.locator("body")).not.toContainText("raw server text");
});

test("placement: a partial-refund agreement explains the credit; the fee amount stays hidden from people who are not finance", async ({ page }) => {
  await mock(page, placementBase({ feeAmount: null, replacementRule: "PARTIAL_REFUND", refundPercent: 50, canEdit: true }),
    { exitOutcome: { exitOutcome: "REFUND_REQUESTED", refundStatus: "REQUESTED", refundAmount: null } });
  await page.goto("/#/recruitment/placements/95");
  await expect(page.locator(".rec-fee-card")).toContainText("القيمة بتظهر للمالية بس");
  await expect(page.locator(".rec-fee-card")).not.toContainText("36,000");
  await page.getByRole("button", { name: "تسجيل ترك المرشح للشغل" }).click();
  await page.getByRole("dialog").getByLabel("ساب يوم").fill("2026-10-01");
  await expect(page.getByRole("dialog").locator(".rec-will")).toContainText("إشعار دائن بنسبة 50% من الأتعاب");
  await page.getByRole("dialog").getByRole("button", { name: "تسجيل الترك" }).click();
  await expect(page.locator(".rec-fee-card")).toContainText("الإشعار الدائن");
  await expect(page.locator(".rec-guarantee-card")).toContainText("اتبعت للمالية طلب إشعار دائن");
});

test("placement: the start is recorded from the page; a missing offered salary is recorded write-only and never shown", async ({ page }) => {
  const { posted } = await mock(page, placementBase({ invoicingStatus: "OFFER_TERMS_MISSING", offerTermsOnFile: false, feeAmount: null, feeRequestedAt: null,
    guaranteeStatus: "NOT_STARTED", startedOn: null, feeMilestones: ["OFFER_ACCEPTED"], guaranteeEndsOn: null, guaranteeDaysLeft: null }));
  await page.goto("/#/recruitment/placements/95");
  await expect(page.locator(".rec-fee-card .rec-why")).toContainText("نسبة من الراتب السنوي المعروض");
  await page.locator(".rec-fee-card").getByLabel("الراتب السنوي المعروض").fill("240000");
  await page.locator(".rec-fee-card").getByRole("button", { name: "تسجيل الراتب المعروض" }).click();
  await expect(page.locator(".rec-fee-card")).toContainText("لسه مش مستحقة");
  expect(posted.find(p => p.path.endsWith("/offer-terms"))).toEqual({ method: "PUT", path: "/recruitment/applications/71/offer-terms",
    body: { version: 6, annualSalary: "240000", currencyCode: "EGP" } });
  await expect(page.locator("body")).not.toContainText("240000");
  await expect(page.locator("body")).not.toContainText("240,000");
  await page.locator(".rec-guarantee-card").getByRole("button", { name: "تسجيل بدء العمل" }).click();
  expect(posted.find(p => p.path.endsWith("/started"))!.body).toEqual({ startedOn: "2026-09-01" });
});

test("job order: placements link to their page with the fee and guarantee status; read-only placements have no actions", async ({ page }) => {
  await mock(page, placementBase({ canEdit: false }));
  await page.goto("/#/recruitment/orders/41");
  const table = page.locator("table");
  await expect(table).toContainText("ساري");
  await expect(table).toContainText("اتبعت للمالية");
  await table.getByRole("link", { name: "فتح التعيين" }).click();
  await expect(page).toHaveURL(/#\/recruitment\/placements\/95$/);
  await expect(page.getByText("عرض فقط: المسؤول وحده يعدّل هذا السجل.")).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل ترك المرشح للشغل" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "طلب الأتعاب من المالية" })).toHaveCount(0);
});

test("placement page: no horizontal scroll on a phone and no serious accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, placementBase());
  await page.goto("/#/recruitment/placements/95");
  await expect(page.locator(".rec-countdown")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const scan = await new AxeBuilder({ page }).include(".rec-record").analyze();
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id)).toEqual([]);
});
