import { expect, test, type Page, type Route } from "@playwright/test";

/** Reference lists in the admin console against a mocked API; the live API is covered by scripts/reference_lists_probe.py. */

type Value = { id: number; version: number; name: string; sequence: number | null; role: string | null; uses: number };

async function mockLists(page: Page) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const lists: Record<string, Value[]> = {
    "lost-reasons": [{ id: 1, version: 0, name: "السعر", sequence: null, role: null, uses: 3 }],
    sources: [],
    "opportunity-stages": [
      { id: 11, version: 0, name: "New", sequence: 10, role: "DEFAULT", uses: 2 },
      { id: 12, version: 0, name: "Qualification", sequence: 20, role: null, uses: 0 },
      { id: 13, version: 0, name: "Proposition", sequence: 30, role: "PROPOSITION", uses: 1 },
      { id: 14, version: 0, name: "Closed won", sequence: 40, role: "WON", uses: 0 },
      { id: 15, version: 0, name: "Closed lost", sequence: 50, role: "LOST", uses: 0 },
    ],
  };
  let nextId = 100;
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
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "admin", name: "Admin", language: "ar", administrator: true }) });
    if (path === "/opportunities/stages" || path === "/business-lines") return result([]);
    if (path === "/admin/lists/opportunity-stages/order") {
      const ids = body.ids as number[];
      const stages = lists["opportunity-stages"];
      const ordered = [...ids.map(id => stages.find(s => s.id === id)!), ...stages.filter(s => s.role === "WON" || s.role === "LOST")];
      ordered.forEach((s, i) => { s.sequence = (i + 1) * 10; s.version += 1; });
      lists["opportunity-stages"] = ordered;
      return result(ordered);
    }
    const m = path.match(/^\/admin\/lists\/([a-z-]+)(?:\/(\d+))?(\/delete)?$/);
    if (m) {
      const values = lists[m[1]];
      if (!values) return failure(404, { code: "NOT_FOUND", fields: [] });
      if (method === "GET") return result(values);
      if (!m[2]) {
        const name = String(body.name ?? "").trim();
        if (values.some(v => v.name.toLowerCase() === name.toLowerCase())) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "name", code: "DUPLICATE" }] });
        const added = { id: nextId++, version: 0, name, sequence: null, role: null, uses: 0 };
        values.push(added);
        return result(added, 201);
      }
      const value = values.find(v => v.id === Number(m[2]))!;
      if (body.version !== value.version) return failure(409, { code: "CONFLICT", fields: [] });
      if (m[3]) {
        if (value.uses > 0) return failure(409, { code: "IN_USE", fields: [] });
        lists[m[1]] = values.filter(v => v !== value);
        return result(lists[m[1]]);
      }
      Object.assign(value, { name: body.name, version: value.version + 1 });
      return result(value);
    }
    if (path.startsWith("/admin/")) return result([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, lists };
}

test("an administrator adds the first lost reasons, renames one inline and cannot delete one in use", async ({ page }) => {
  const { posted } = await mockLists(page);
  await page.goto("/#/admin/lists");
  await page.getByRole("tab", { name: "القوائم" }).waitFor();
  await expect(page.getByText("السعر", { exact: true })).toBeVisible();
  await expect(page.getByText("مستخدم 3 مرات")).toBeVisible();
  await expect(page.getByRole("button", { name: "حذف: السعر" })).toBeDisabled();
  const field = page.getByRole("textbox", { name: "أسباب الخسارة" });
  await field.fill("اختاروا منافس");
  await field.press("Enter");
  await expect(page.getByText("اختاروا منافس", { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await field.fill("السعر");
  await page.getByRole("button", { name: "إضافة" }).click();
  await expect(page.getByRole("alert")).toContainText("الاسم ده موجود");
  await page.getByRole("button", { name: "إعادة تسمية: اختاروا منافس" }).click();
  const edit = page.getByRole("textbox", { name: "إعادة تسمية" });
  await edit.fill("اختاروا مورد آخر");
  await edit.press("Enter");
  await expect(page.getByText("اختاروا مورد آخر", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "حذف: اختاروا مورد آخر" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await expect(page.getByText("اختاروا مورد آخر", { exact: true })).toHaveCount(0);
  expect(posted.map(p => p.path)).toEqual(["/admin/lists/lost-reasons", "/admin/lists/lost-reasons", "/admin/lists/lost-reasons/100", "/admin/lists/lost-reasons/100/delete"]);
  expect(posted[2].body).toEqual({ version: 0, name: "اختاروا مورد آخر" });
});

test("opportunity stages: core stages are marked and locked, and the open stages reorder with the keyboard", async ({ page }) => {
  const { posted } = await mockLists(page);
  await page.goto("/#/admin/lists");
  await page.getByRole("tab", { name: "مراحل الفرص" }).click();
  await expect(page.getByText("مرحلة الفوز")).toBeVisible();
  await expect(page.locator(".admin-list-rows.is-fixed .admin-list-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^حذف: / }).first()).toBeDisabled();
  const handle = page.getByRole("button", { name: /اسحب لتغيير الترتيب: .*تأهيل|اسحب لتغيير الترتيب: Qualification/ });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await expect(page.locator(".admin-list-notice")).toContainText("اتحفظ الترتيب الجديد");
  expect(posted.find(p => p.path === "/admin/lists/opportunity-stages/order")!.body).toEqual({ ids: [12, 11, 13] });
  await expect(page.locator(".admin-list-rows.is-sortable .admin-list-row").first()).toContainText(/تأهيل|Qualification/);
});
