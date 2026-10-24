import { expect, test, type Page, type Route } from "@playwright/test";

/** Finance's invoicing queue (D-06) against a mocked API; the live API is covered by scripts/finance_probe.py. */

async function mockFinance(page: Page, { invoicesPermitted = false } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const queue = [
    { id: 1, version: 0, status: "REQUESTED", orderId: 10, orderReference: "SO0012", accountId: 7, accountName: "مصنع النور", milestoneId: 100,
      milestoneTitle: "دفعة مقدمة", dueDate: "2026-10-21", amountBeforeTax: 12000, currency: "EGP", requestedBy: "سارة منصور",
      requestedAt: "2026-10-22T10:00:00Z", ageDays: 2, overdue: true, mine: false, invoiceStatus: "BLOCKED_BY_POLICY" },
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
    if (path === "/finance/summary") return result({ ordersPermitted: true, requestsPermitted: true, invoicesPermitted,
      rows: [{ currency: "EGP", booked: 30000, requested: queue.filter(r => r.status === "REQUESTED").reduce((n, r) => n + r.amountBeforeTax, 0),
        invoiced: invoicesPermitted ? 0 : null, collected: invoicesPermitted ? 0 : null }] });
    if (path === "/finance/queue") {
      const state = url.searchParams.get("state");
      return result(queue.filter(r => state === "all" || (state === "cancelled" ? r.status === "CANCELLED" : r.status === "REQUESTED")));
    }
    if (path === "/finance/milestones") return result(Number(url.searchParams.get("within")) >= 7 ? upcoming : []);
    if (path === "/workspace/invoice-requests" && method === "POST") {
      const m = upcoming.find(x => x.id === body.milestoneId)!;
      if (body.quoteVersion !== m.orderVersion) return failure(409, { code: "CONFLICT", fields: [] });
      upcoming.splice(upcoming.indexOf(m), 1);
      queue.push({ ...queue[0], id: 2, milestoneId: m.id, milestoneTitle: m.title, dueDate: m.dueDate, amountBeforeTax: m.amountBeforeTax!, overdue: false, ageDays: 0, mine: true, requestedBy: "منى" });
      return result({ id: 2 }, 201);
    }
    if (/\/invoice-requests\/\d+\/issue$/.test(path)) return failure(422, { code: "BLOCKED_BY_POLICY", fields: [] });
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

test("finance's queue: the held policy is stated, figures are real, and issuing explains D-06 without creating anything", async ({ page }) => {
  const { posted } = await mockFinance(page);
  await page.goto("/#/finance");
  await expect(page.getByRole("heading", { name: "الفواتير والتحصيل", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("إصدار الفاتورة وحساب الضريبة والفاتورة الإلكترونية موقوفين");
  const money = page.locator(".finance-money");
  await expect(money).toContainText("طلبات مؤكدة (قبل الضريبة)");
  await expect(money).toContainText(/(30,000|٣٠٬٠٠٠) EGP/);
  // invoices the person may not read are not shown as zero
  await expect(money.locator("div").filter({ hasText: "فواتير صادرة" })).toContainText("مش ضمن صلاحياتك");
  const row = page.locator(".finance-row").filter({ hasText: "دفعة مقدمة" });
  await expect(row).toContainText("فات معاده");
  await expect(row).toContainText(/(12,000|١٢٬٠٠٠) EGP/);
  await row.getByRole("button", { name: "إصدار الفاتورة" }).click();
  await expect(page.getByRole("alert")).toHaveText("إصدار الفاتورة موقوف لحد اعتماد سياسة المالية والضرائب (D-06). مفيش فاتورة اتعملت.");
  await row.getByRole("button", { name: "إلغاء الطلب: دفعة مقدمة" }).click();
  await expect(page.getByRole("alert")).toHaveText("مش مسموح لك بالإجراء ده.");
  expect(posted.map(p => p.path)).toEqual(["/workspace/invoice-requests/1/issue", "/workspace/invoice-requests/1/cancel"]);
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
