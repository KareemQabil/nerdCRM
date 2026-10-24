import { expect, test, type Page, type Route } from "@playwright/test";

/** The service catalogue against a mocked API; the live API is covered by scripts/catalog_probe.py. */

async function mockCatalog(page: Page, options: { manager: boolean }) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const services = [
    { id: 1, version: 2, code: "ISO-AUDIT-DAY", name: "يوم مراجعة ISO 9001", summary: "يوم عمل لمراجع معتمد", type: "service", unitId: 3, unit: "يوم",
      salePrice: 4500, currencyCode: "EGP", onSale: true, categoryId: null, category: null, startDate: null, endDate: null, accountingReady: true },
    { id: 2, version: 0, code: "QM-SETUP", name: "إعداد دليل الجودة", summary: null, type: "service", unitId: null, unit: null,
      salePrice: 12000, currencyCode: "EGP", onSale: false, categoryId: null, category: null, startDate: null, endDate: null, accountingReady: false },
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
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "sara", name: "سارة", language: "ar" }) });
    if (path === "/business-lines") return result([]);
    if (path === "/catalog/products/units") return result([{ id: 3, name: "يوم" }, { id: 4, name: "ساعة" }]);
    if (path === "/catalog/products/categories") return result([]);
    if (path === "/catalog/products" && method === "GET") {
      if (url.searchParams.get("all") === "true") return options.manager ? result(services) : failure(403, { code: "FORBIDDEN", fields: [] });
      return result(services.filter(s => s.onSale).map(s => ({ id: s.id, code: s.code, name: s.name, unit: s.unit, salePrice: s.salePrice, currency: s.currencyCode })));
    }
    if (path === "/catalog/products" && method === "POST") {
      if (String(body.code).toUpperCase() === "QM-SETUP") return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "code", code: "DUPLICATE" }] });
      const added = { id: 9, version: 0, code: String(body.code), name: String(body.name), summary: (body.summary as string) || null, type: "service", unitId: Number(body.unitId) || null,
        unit: body.unitId === 3 ? "يوم" : null, salePrice: Number(body.salePrice), currencyCode: String(body.currencyCode), onSale: true, categoryId: null, category: null,
        startDate: null, endDate: null, accountingReady: false };
      services.push(added);
      return result(added, 201);
    }
    const one = path.match(/^\/catalog\/products\/(\d+)$/);
    if (one && method === "POST") {
      const s = services.find(x => x.id === Number(one[1]))!;
      if (body.version !== s.version) return failure(409, { code: "CONFLICT", fields: [] });
      Object.assign(s, { name: body.name, salePrice: Number(body.salePrice), onSale: body.onSale, version: s.version + 1 });
      return result(s);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return posted;
}

test("a catalogue manager adds a service with its price before tax; a duplicate code is explained", async ({ page }) => {
  const posted = await mockCatalog(page, { manager: true });
  await page.goto("/#/catalog");
  await expect(page.getByRole("heading", { name: "كتالوج الخدمات" })).toBeVisible();
  await expect(page.locator(".catalog-card")).toHaveCount(2);
  await expect(page.getByText("جاهزة للفوترة")).toBeVisible();
  await expect(page.getByText("إعداد الحسابات عند المالية")).toBeVisible();
  await page.getByRole("button", { name: "موقوفة" }).click();
  await expect(page.locator(".catalog-card")).toHaveCount(1);
  await page.getByRole("button", { name: "الكل" }).click();
  await page.getByRole("button", { name: "خدمة جديدة" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("لا يُحدد هنا أي ضريبة");
  await dialog.getByLabel("اسم الخدمة").fill("ساعة استشارة");
  await dialog.getByLabel("الكود").fill("qm-setup");
  await expect(dialog.getByLabel("الكود")).toHaveValue("QM-SETUP");
  await dialog.getByLabel("السعر قبل الضريبة").fill("950");
  await dialog.getByLabel("وحدة البيع").selectOption({ label: "يوم" });
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("alert")).toContainText("الكود ده مستخدم لخدمة تانية");
  await dialog.getByLabel("الكود").fill("CONSULT-HOUR");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".catalog-card")).toHaveCount(3);
  expect(posted[1].body).toMatchObject({ code: "CONSULT-HOUR", name: "ساعة استشارة", salePrice: "950", currencyCode: "EGP", unitId: 3, onSale: true });
});

test("a manager takes a service off sale with its version", async ({ page }) => {
  const posted = await mockCatalog(page, { manager: true });
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "تعديل: يوم مراجعة ISO 9001" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("السعر قبل الضريبة")).toHaveValue("4500");
  await dialog.getByLabel("متاحة للبيع في عروض الأسعار").uncheck();
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posted[0]).toMatchObject({ path: "/catalog/products/1", body: { version: 2, onSale: false } });
  await expect(page.locator(".catalog-card.is-off")).toHaveCount(2);
});

test("a seller sees only the services on sale and no management controls", async ({ page }) => {
  await mockCatalog(page, { manager: false });
  await page.goto("/#/catalog");
  await expect(page.locator(".catalog-card")).toHaveCount(1);
  await expect(page.getByText("بتشوف الخدمات المتاحة للبيع بس")).toBeVisible();
  await expect(page.getByRole("button", { name: "خدمة جديدة" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^تعديل/ })).toHaveCount(0);
});
