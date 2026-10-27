import { expect, test, type Page, type Route } from "@playwright/test";

/** Finance's invoicing queue (D-06) against a mocked API; the live API is covered by scripts/finance_probe.py. */

type Fx = { policySet: boolean; source: string | null; maxAgeHours: number | null; baseCurrency: string; canChange: boolean;
  currencies: Record<string, unknown>[]; history: Record<string, unknown>[] };

async function mockFinance(page: Page, { invoicesPermitted = false, fx = null as Fx | null, usd = false, canIssue = false, ready = false } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const queue = [
    { id: 1, version: 0, status: "REQUESTED", orderId: 10, orderReference: "SO0012", accountId: 7, accountName: "مصنع النور", milestoneId: 100,
      milestoneTitle: "دفعة مقدمة", dueDate: "2026-10-21", amountBeforeTax: 12000, currency: "EGP", requestedBy: "سارة منصور",
      requestedAt: "2026-10-22T10:00:00Z", ageDays: 2, overdue: true, mine: false, canIssue,
      invoiceNumber: null as string | null, invoiceTotal: null as number | null, invoiceDueDate: null as string | null },
  ];
  const upcoming = [
    { id: 101, title: "تقرير المرحلة الأولى", dueDate: "2026-11-03", amountBeforeTax: 18000, currency: "EGP", orderId: 10, orderVersion: 4,
      orderReference: "SO0012", accountId: 7, accountName: "مصنع النور", overdue: false, daysLeft: 10 },
  ];
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
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "mona", name: "منى", language: "ar" }) });
    if (path === "/business-lines") return result([]);
    if (path === "/finance/summary") {
      const requested = queue.filter(r => r.status === "REQUESTED").reduce((n, r) => n + r.amountBeforeTax, 0);
      const usdRate = fx?.currencies.find(c => c.currency === "USD" && !c.stale)?.rate as number | undefined;
      const rows: Record<string, unknown>[] = [{ currency: "EGP", booked: 30000, requested, invoiced: invoicesPermitted ? 0 : null, collected: invoicesPermitted ? 0 : null,
        fxStatus: "BASE", rate: 1, bookedInBase: 30000, requestedInBase: requested }];
      if (usd) rows.push({ currency: "USD", booked: 1000, requested: 0, invoiced: null, collected: null, fxStatus: usdRate ? "OK" : "NO_RATE",
        rate: usdRate ?? null, rateDate: usdRate ? "2026-10-25" : null, bookedInBase: usdRate ? 1000 * usdRate : null, requestedInBase: usdRate ? 0 : null });
      return result({ ordersPermitted: true, requestsPermitted: true, invoicesPermitted, rows, baseCurrency: "EGP",
        totalInBase: usd && !usdRate ? null : { currency: "EGP", booked: 30000 + (usd ? 1000 * usdRate! : 0), requested, invoiced: null, collected: null } });
    }
    if (path === "/finance/fx" && method === "GET") return fx ? result(fx) : failure(403, { code: "FORBIDDEN", fields: [] });
    if (path === "/finance/fx/refresh" && fx) {
      fx.currencies = fx.currencies.map(c => c.currency === "EUR" ? { ...c, rate: 54.054054, source: "PUBLIC_API", stale: false, ageHours: 0, rateDate: "2026-10-25" } : c);
      return result(fx);
    }
    if (path === "/finance/fx/rates" && fx) {
      if (!String(body.reason ?? "").trim()) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "reason", code: "REQUIRED" }] });
      fx.currencies = fx.currencies.map(c => c.currency === body.currency ? { ...c, rate: body.rate, source: "MANUAL", stale: false, ageHours: 0, rateDate: body.rateDate } : c);
      fx.history = [{ id: 9, currency: body.currency, rate: body.rate, rateDate: body.rateDate, asOf: `${body.rateDate}T00:00:00`, source: "MANUAL", provider: null,
        reason: body.reason, enteredBy: "منى", recordedAt: "2026-10-25T10:00:00" }, ...fx.history];
      return result(fx, 201);
    }
    if (path === "/finance/queue") {
      const state = url.searchParams.get("state");
      return result(queue.filter(r => state === "all" || r.status === (state === "cancelled" ? "CANCELLED" : state === "issued" ? "ISSUED" : "REQUESTED")));
    }
    if (path === "/finance/milestones") return result(Number(url.searchParams.get("within")) >= 7 ? upcoming : []);
    if (path === "/workspace/invoice-requests" && method === "POST") {
      const m = upcoming.find(x => x.id === body.milestoneId)!;
      if (body.quoteVersion !== m.orderVersion) return failure(409, { code: "CONFLICT", fields: [] });
      upcoming.splice(upcoming.indexOf(m), 1);
      queue.push({ ...queue[0], id: 2, milestoneId: m.id, milestoneTitle: m.title, dueDate: m.dueDate, amountBeforeTax: m.amountBeforeTax!, overdue: false, ageDays: 0, mine: true, requestedBy: "منى" });
      return result({ id: 2 }, 201);
    }
    if (/\/finance\/requests\/\d+\/readiness$/.test(path)) return result(ready ? { ready: true, missing: [] } : { ready: false, missing: [
      { code: "PAYMENT_TERMS_POLICY", detail: "finance.payment-terms" }, { code: "SALES_JOURNAL", detail: null }, { code: "TAX_ACCOUNT", detail: "IOETI-DEFAULT" }] });
    const issue = path.match(/\/invoice-requests\/(\d+)\/issue$/);
    if (issue) {
      if (!canIssue) return failure(403, { code: "FORBIDDEN", fields: [] });
      if (!ready) return failure(422, { code: "ACCOUNTING_NOT_READY", fields: [{ field: "accounting", code: "SALES_JOURNAL" }, { field: "accounting", code: "TAX_ACCOUNT" }] });
      const r = queue.find(x => x.id === Number(issue[1]))!;
      Object.assign(r, { status: "ISSUED", version: r.version + 1, invoiceNumber: "INV-00001", invoiceTotal: 13680, invoiceDueDate: "2026-11-24" });
      return result(r);
    }
    const cancel = path.match(/\/invoice-requests\/(\d+)\/cancel$/);
    if (cancel) {
      const r = queue.find(x => x.id === Number(cancel[1]))!;
      if (!r.mine) return failure(403, { code: "FORBIDDEN", fields: [] });
      r.status = "CANCELLED";
      return result(r);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted };
}

test("finance's queue: the D-06 note, real figures; without native invoice rights there is no issue action", async ({ page }) => {
  const { posted } = await mockFinance(page);
  await page.goto("/#/finance");
  await expect(page.getByRole("heading", { name: "الفواتير والتحصيل", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("المالية بتصدر الفاتورة في حسابات Axelor");
  // without native rights on exchange rates the panel is not shown
  await expect(page.getByRole("region", { name: "أسعار الصرف للجنيه" })).toHaveCount(0);
  const money = page.locator(".finance-money");
  await expect(money).toContainText("طلبات مؤكدة (قبل الضريبة)");
  await expect(money).toContainText(/(30,000|٣٠٬٠٠٠) EGP/);
  // invoices the person may not read are not shown as zero
  await expect(money.locator("div").filter({ hasText: "فواتير صادرة" })).toContainText("مش ضمن صلاحياتك");
  const row = page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" });
  await expect(row).toContainText("فات معاده");
  await expect(row).toContainText(/(12,000|١٢٬٠٠٠) EGP/);
  await expect(row.getByRole("button", { name: "إصدار الفاتورة" })).toHaveCount(0);
  await row.getByRole("button", { name: "إلغاء الطلب: دفعة مقدمة" }).click();
  await expect(page.getByRole("alert")).toHaveText("مش مسموح لك بالإجراء ده.");
  expect(posted.map(p => p.path)).toEqual(["/workspace/invoice-requests/1/cancel"]);
});

test("issuing: while the owners' terms or the accounting set-up are missing, finance is told exactly what is missing and nothing is created", async ({ page }) => {
  const { posted } = await mockFinance(page, { canIssue: true });
  await page.goto("/#/finance");
  const row = page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" });
  await row.getByRole("button", { name: "إصدار الفاتورة" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("مش ممكن تتصدر لسه. الناقص:");
  await expect(alert.locator("li")).toHaveText(["مالك السياسات لسه ما حددش شروط السداد", "يومية المبيعات", "حساب الضريبة المحصّلة (IOETI-DEFAULT)"]);
  await expect(row).not.toContainText("INV-");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/ioeti-finance-missing-phone.png", fullPage: true });
  expect(posted).toEqual([{ path: "/workspace/invoice-requests/1/issue", body: { version: 0 } }]);
});

test("issuing: with everything in place finance issues the invoice; it shows its number, total with tax and due date under issued", async ({ page }) => {
  const { posted } = await mockFinance(page, { canIssue: true, ready: true });
  await page.goto("/#/finance");
  await page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" }).getByRole("button", { name: "إصدار الفاتورة" }).click();
  await expect(page.getByRole("status").filter({ hasText: "اتصدرت الفاتورة INV-00001." })).toBeVisible();
  await expect(page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" })).toHaveCount(0);
  await page.getByRole("button", { name: "صدرت فواتيرها" }).click();
  const issued = page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" });
  await expect(issued).toContainText("INV-00001");
  await expect(issued).toContainText(/(13,680|١٣٬٦٨٠) EGP شامل الضريبة/);
  await expect(issued).toContainText("صادرة");
  await page.screenshot({ path: "test-results/ioeti-finance-issued.png", fullPage: true });
  expect(posted).toEqual([{ path: "/workspace/invoice-requests/1/issue", body: { version: 0 } }]);
});

test("a milestone coming due is requested for invoicing with the order's version, then moves to the queue and can be cancelled", async ({ page }) => {
  const { posted } = await mockFinance(page, { invoicesPermitted: true });
  await page.goto("/#/finance");
  await expect(page.locator(".finance-money div").filter({ hasText: "فواتير صادرة" })).toContainText(/^[^0-9٠-٩]*[0٠] EGP$/);
  const upcoming = page.getByRole("region", { name: "أقساط جاي معادها" });
  await expect(upcoming.locator(".finance-row")).toContainText("بعد 10 يوم");
  await upcoming.getByRole("button", { name: "اطلب الفوترة" }).click();
  await expect(page.locator(".finance-ok")).toHaveText("اتطلبت الفوترة.");
  await expect(upcoming.getByText("مفيش أقساط مستحقة من غير طلب فوترة في الفترة دي.")).toBeVisible();
  expect(posted[0]).toEqual({ path: "/workspace/invoice-requests", body: { milestoneId: 101, quoteVersion: 4 } });
  const queue = page.getByRole("region", { name: "طلبات الفوترة" });
  const mine = queue.locator(".finance-row").filter({ hasText: "تقرير المرحلة الأولى" });
  await expect(mine).toContainText("أنت");
  await mine.getByRole("button", { name: "إلغاء الطلب: تقرير المرحلة الأولى" }).click();
  await expect(page.locator(".finance-ok")).toHaveText("الطلب اتلغى.");
  await expect(queue.locator(".finance-row").filter({ hasText: "تقرير المرحلة الأولى" })).toHaveCount(0);
  await queue.getByRole("button", { name: "ملغاة" }).click();
  await expect(queue.locator(".finance-row.is-cancelled")).toContainText("تقرير المرحلة الأولى");
});

test("exchange rates: the rate in use per currency, a stale one flagged, fetched from the public source or entered by hand with a reason; totals in EGP", async ({ page }) => {
  const fx: Fx = { policySet: true, source: "PUBLIC_API", maxAgeHours: 48, baseCurrency: "EGP", canChange: true,
    currencies: [{ currency: "USD", rate: null, rateDate: null, asOf: null, source: null, ageHours: null, stale: false },
      { currency: "EUR", rate: 52, rateDate: "2026-10-22", asOf: "2026-10-22T00:00:00", source: "MANUAL", ageHours: 82, stale: true }],
    history: [] };
  const { posted } = await mockFinance(page, { fx, usd: true });
  await page.goto("/#/finance");
  const panel = page.getByRole("region", { name: "أسعار الصرف للجنيه" });
  await expect(panel).toContainText("مصدر عام، والمالية تقدر تعدّل يدويًا");
  await expect(panel).toContainText("السعر الأقدم من 48 ساعة ما بيتستخدمش.");
  await expect(panel.locator(".fx-row").filter({ hasText: "USD" })).toContainText("لسه مفيش سعر");
  await expect(panel.locator(".fx-row").filter({ hasText: "EUR" })).toContainText("قديم، مش بيتستخدم");
  // the USD figures cannot be converted yet, so there is no EGP total
  await expect(page.locator(".finance-currency").filter({ hasText: "USD" })).toContainText("مفيش سعر صرف");
  await expect(page.locator(".finance-summary")).toContainText("الإجمالي بالجنيه مش متاح");

  await panel.getByRole("button", { name: "حدّث من المصدر العام" }).click();
  await expect(panel.locator(".fx-row").filter({ hasText: "EUR" })).not.toContainText("قديم");
  await panel.getByRole("button", { name: "أدخل سعر يدوي" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("العملة").selectOption("USD");
  await dialog.getByLabel("كام EGP للوحدة").fill("48.5");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled(); // a reason is required
  await dialog.getByLabel("السبب").fill("سعر البنك");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.locator(".fx-row").filter({ hasText: "USD" })).toContainText(/(48\.5|٤٨٫٥) EGP/);
  await panel.getByText("آخر الأسعار المسجلة").click();
  await expect(panel.locator(".fx-history")).toContainText("سعر البنك");
  await expect(page.locator(".finance-total")).toContainText(/(78,500|٧٨٬٥٠٠) EGP/);
  await page.screenshot({ path: "test-results/ioeti-finance-fx.png", fullPage: true });
  // phone width: nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/ioeti-finance-fx-phone.png", fullPage: true });
  expect(posted.filter(p => p.path.startsWith("/finance/fx"))).toEqual([{ path: "/finance/fx/refresh", body: {} },
    { path: "/finance/fx/rates", body: { currency: "USD", rate: 48.5, rateDate: new Date().toISOString().slice(0, 10), reason: "سعر البنك" } }]);
});

test("exchange rates: without the owners' finance.fx policy nothing converts and nothing can be entered", async ({ page }) => {
  await mockFinance(page, { fx: { policySet: false, source: null, maxAgeHours: null, baseCurrency: "EGP", canChange: true, currencies: [], history: [] } });
  await page.goto("/#/finance");
  const panel = page.getByRole("region", { name: "أسعار الصرف للجنيه" });
  await expect(panel).toContainText("مالك السياسات لسه ما حددش مصدر أسعار الصرف (finance.fx)");
  await expect(panel.getByRole("button")).toHaveCount(0);
});
