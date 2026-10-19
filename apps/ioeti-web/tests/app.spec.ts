import { expect, test, type Page, type Route } from "@playwright/test";

const lines = [
  { id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 10, responsibleTeam: null },
  { id: 2, code: "TRAINING", nameAr: "التدريب", nameEn: "Training", status: 2, sequence: 20, responsibleTeam: null },
];

type MockRecord = { id: number; version: number; name: string; reference: string; businessLineCode: string; businessLineNameAr: string; businessLineNameEn: string; stage: string | null };

async function intercept(page: Page, config: { businessLineDenied?: boolean } = {}) {
  let records: MockRecord[] = [{
    id: 101, version: 1, name: "Hotel certification", reference: "OP-101",
    businessLineCode: "ISO9001", businessLineNameAr: "أيزو 9001", businessLineNameEn: "ISO 9001", stage: null,
  }];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path.endsWith("/session")) return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ code: "pilot.user", name: "Pilot user", language: "ar" }),
    });
    if (path.endsWith("/business-lines")) {
      if (config.businessLineDenied) return route.fulfill({ status: 403, body: "{}" });
      return result(lines);
    }
    if (path.endsWith("/opportunities") && method === "GET") return result(records);
    if (path.endsWith("/opportunities") && method === "POST") {
      const body = route.request().postDataJSON() as { name: string; businessLineCode: string };
      const line = lines.find(item => item.code === body.businessLineCode);
      const created = { id: 102, version: 1, name: body.name, reference: "OP-102", businessLineCode: body.businessLineCode,
        businessLineNameAr: line?.nameAr || "", businessLineNameEn: line?.nameEn || "", stage: null };
      records = [created, ...records];
      return result(created, 201);
    }
    if (path.includes("/opportunities/") && method === "PUT") {
      const id = Number(path.split("/").at(-1));
      const body = route.request().postDataJSON() as { name: string; version: number };
      const current = records.find(item => item.id === id);
      if (!current || current.version !== body.version) {
        return route.fulfill({ status: 409, body: "{}" });
      }
      const updated = { ...current, name: body.name, version: current.version + 1 };
      records = records.map(item => item.id === id ? updated : item);
      return result(updated);
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
}

test("Arabic theme switching preserves a real-API-shaped business line screen", async ({ page }) => {
  await intercept(page);
  await page.goto("/");
  await expect(page.getByText("أهلًا بك في IOETI")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "نظام التصميم" }).click();
  await page.getByRole("button", { name: "فاخر" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await page.getByRole("button", { name: "مضغوط" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.getByRole("button", { name: "مختصر" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-navigation", "rail");
  await page.getByRole("button", { name: "اللغة" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("opportunity create and rename use typed application endpoints", async ({ page }) => {
  await intercept(page);
  await page.goto("/");
  await page.getByRole("button", { name: "المبيعات" }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
  await page.getByRole("button", { name: "فرصة جديدة" }).click();
  await page.getByLabel("اسم الفرصة").fill("New customer opportunity");
  await page.getByLabel("خطوط الأعمال").selectOption("ISO9001");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("New customer opportunity")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "New customer opportunity" });
  await row.getByRole("button", { name: /تعديل اسم الفرصة/ }).click();
  await page.getByLabel("اسم الفرصة").fill("New customer opportunity updated");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("New customer opportunity updated")).toBeVisible();
});

test("lack of BusinessLine permissions is not treated as failed session login", async ({ page }) => {
  await intercept(page, { businessLineDenied: true });
  await page.goto("/");
  await expect(page.getByText("أهلًا بك في IOETI")).toBeVisible();
  await expect(page.getByText("حسابك لا يملك صلاحية قراءة خطوط الأعمال.")).toBeVisible();
  await page.getByRole("button", { name: "المبيعات" }).click();
  await expect(page.getByText("Hotel certification")).toBeVisible();
});
