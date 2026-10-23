import { expect, test, type Page, type Route } from "@playwright/test";

/** Admin console and the forced password change, against a mocked API (the live API is covered by scripts/admin_probe.py). */

type Person = {
  id: number; version: number; code: string; name: string; contactOnFile: boolean; language: string; active: boolean;
  mustChangePassword: boolean; profileCode: string | null; profileName: string | null; administrator: boolean;
  businessLines: string[]; teams: { id: number; name: string }[]; createdOn: string | null;
};

const lines = [
  { id: 1, version: 3, code: "ISO9001", nameEn: "ISO 9001", nameAr: "أيزو 9001", status: 2, sequence: 10, purpose: null, responsibleTeam: null, manager: null, members: 1 },
  { id: 2, version: 1, code: "TRAINING", nameEn: "Training", nameAr: "التدريب", status: 2, sequence: 20, purpose: null, responsibleTeam: null, manager: null, members: 0 },
];
const profiles = [
  { id: 1, code: "admins", name: "Administrators", administrator: true, people: 1, rules: 0 },
  { id: 7, code: "sales", name: "Sales", administrator: false, people: 1, rules: 2 },
];

async function mockAdmin(page: Page, options: { administrator?: boolean } = {}) {
  const people: Person[] = [
    { id: 1, version: 4, code: "admin", name: "Admin", contactOnFile: false, language: "ar", active: true, mustChangePassword: false,
      profileCode: "admins", profileName: "Administrators", administrator: true, businessLines: [], teams: [], createdOn: null },
    { id: 9, version: 2, code: "sara.mansour", name: "سارة منصور", contactOnFile: true, language: "ar", active: true, mustChangePassword: false,
      profileCode: "sales", profileName: "Sales", administrator: false, businessLines: ["ISO9001"], teams: [], createdOn: null },
  ];
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "admin", name: "Admin", language: "ar", administrator: options.administrator ?? true }) });
    if (path === "/business-lines") return result(lines);
    if (path.startsWith("/admin") && !(options.administrator ?? true)) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    if (path === "/admin/users" && method === "GET") {
      const status = url.searchParams.get("status");
      return result(people.filter(p => !status || (status === "active") === p.active));
    }
    if (path === "/admin/users" && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push({ path, body });
      if (body.code === "taken.name") return route.fulfill({ status: 422, contentType: "application/json",
        body: JSON.stringify({ codeStatus: 422, error: { code: "VALIDATION_FAILED", fields: [{ field: "code", code: "DUPLICATE" }] } }) });
      const created: Person = { id: 20, version: 1, code: String(body.code), name: String(body.name), contactOnFile: !!body.email, language: String(body.language),
        active: true, mustChangePassword: true, profileCode: (body.profileCode as string) || null, profileName: body.profileCode ? "Sales" : null,
        administrator: false, businessLines: body.businessLines as string[], teams: [], createdOn: null };
      people.push(created);
      return result(created, 201);
    }
    const one = path.match(/^\/admin\/users\/(\d+)$/);
    if (one && method === "GET") {
      const person = people.find(p => p.id === Number(one[1]));
      return person ? result({ user: person, access: { code: person.profileCode, name: person.profileName, administrator: person.administrator,
        rights: [{ object: "com.axelor.apps.crm.db.Lead", read: true, write: true, create: true, remove: false, conditional: true }] } }) : result(null, 404);
    }
    const action = path.match(/^\/admin\/users\/(\d+)\/(deactivate|activate|password)$/);
    if (action && method === "POST") {
      const person = people.find(p => p.id === Number(action[1]))!;
      posted.push({ path, body: route.request().postDataJSON() as Record<string, unknown> });
      if (action[2] === "deactivate") person.active = false;
      if (action[2] === "activate") person.active = true;
      if (action[2] === "password") person.mustChangePassword = true;
      person.version += 1;
      return result(person);
    }
    if (path === "/admin/profiles") return result(profiles);
    if (path.startsWith("/admin/profiles/")) return result({ code: "sales", name: "Sales", administrator: false, rights: [] });
    if (path === "/admin/teams") return result([]);
    if (path === "/admin/business-lines") return result(lines);
    if (path === "/admin/audit") return result([{ id: 5, action: "USER_CREATED", subject: "USER", subjectId: 9, subjectLabel: "sara.mansour",
      changes: "created; language=ar; businessLines=[ISO9001]", actorName: "Admin", createdAt: "2026-10-23T09:00:00" }]);
    return result([]);
  });
  return posted;
}

test("an administrator adds a person and gets a temporary password to hand over", async ({ page }) => {
  const posted = await mockAdmin(page);
  await page.goto("/#/admin/people");
  await expect(page.getByRole("heading", { name: "لوحة الإدارة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "لوحة الإدارة" })).toBeVisible();
  await expect(page.getByText("sara.mansour")).toBeVisible();
  await page.getByRole("button", { name: "إضافة شخص" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("الاسم الكامل", { exact: true }).fill("هدى سمير");
  await dialog.getByLabel("اسم الدخول", { exact: true }).fill("taken.name");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("alert")).toContainText("مستخدمة قبل كده");
  await dialog.getByLabel("اسم الدخول", { exact: true }).fill("Hoda.Samir");
  await expect(dialog.getByLabel("اسم الدخول", { exact: true })).toHaveValue("hoda.samir");
  await dialog.getByLabel("ملف الصلاحيات").selectOption("sales");
  await dialog.getByRole("combobox", { name: "اختر…" }).first().selectOption("ISO9001");
  const temp = await dialog.getByLabel("كلمة مرور مؤقتة").inputValue();
  expect(temp).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{16}$/);
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog.getByRole("heading", { name: "الحساب جاهز" })).toBeVisible();
  await expect(dialog.getByText("hoda.samir")).toBeVisible();
  await expect(dialog.getByLabel("كلمة مرور مؤقتة")).toHaveValue(temp);
  const body = posted.find(p => p.path === "/admin/users" && p.body.code === "hoda.samir")!.body;
  expect(body).toMatchObject({ name: "هدى سمير", profileCode: "sales", businessLines: ["ISO9001"], temporaryPassword: temp, language: "ar" });
});

test("deactivating a person asks first and keeps the person in the list", async ({ page }) => {
  const posted = await mockAdmin(page);
  await page.goto("/#/admin/people/9");
  await expect(page.getByRole("heading", { name: "سارة منصور" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "العملاء المحتملون" })).toBeVisible();
  await page.getByRole("button", { name: "إيقاف الحساب" }).click();
  await expect(page.getByRole("dialog")).toContainText("أي جلسة مفتوحة له هتتقفل");
  await page.getByRole("dialog").getByRole("button", { name: "إيقاف الحساب" }).click();
  await expect(page.getByRole("button", { name: "تفعيل الحساب" })).toBeVisible();
  expect(posted.some(p => p.path === "/admin/users/9/deactivate" && p.body.version === 2)).toBe(true);
});

test("the console is not offered to people who are not administrators, and the API refuses them", async ({ page }) => {
  await mockAdmin(page, { administrator: false });
  await page.goto("/#/admin/people");
  await expect(page.getByRole("button", { name: "لوحة الإدارة" })).toHaveCount(0);
  await expect(page.getByRole("alert").first()).toContainText("لمسؤولي النظام بس");
});

test("a temporary password must be replaced at the first sign-in", async ({ page }) => {
  let signedIn = false;
  const callbacks: Record<string, unknown>[] = [];
  await page.route("**/axelor-erp/callback", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    callbacks.push(body);
    if (!body.newPassword) return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ route: { path: "/change-password", state: { passwordRequirements: "" } } }) });
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/axelor-erp/ws/ioeti/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return signedIn
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "hoda.samir", name: "هدى سمير", language: "ar", administrator: false }) })
      : route.fulfill({ status: 401, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ codeStatus: 200, object: [] }) });
  });
  await page.goto("/");
  await page.getByLabel("اسم المستخدم").fill("hoda.samir");
  await page.getByLabel("كلمة المرور").fill("Temp-Pass-2026x");
  await page.getByRole("button", { name: /دخول/ }).click();
  await expect(page.getByRole("heading", { name: "اختر كلمة مرور جديدة" })).toBeVisible();
  await page.getByLabel("كلمة المرور الجديدة").fill("Hoda-Own-Pass-2026");
  await page.getByLabel("تأكيد كلمة المرور").fill("Hoda-Own-Pass-2027");
  await page.getByRole("button", { name: "حفظ والدخول" }).click();
  await expect(page.getByRole("alert")).toContainText("غير متطابقتين");
  expect(callbacks).toHaveLength(1);
  await page.getByLabel("كلمة المرور الجديدة").fill("Hoda-Own-Pass-2026");
  await page.getByLabel("تأكيد كلمة المرور").fill("Hoda-Own-Pass-2026");
  await page.getByRole("button", { name: "حفظ والدخول" }).click();
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
  expect(callbacks.at(-1)).toEqual({ username: "hoda.samir", password: "Temp-Pass-2026x", newPassword: "Hoda-Own-Pass-2026" });
});
