import { expect, test, type Page, type Route } from "@playwright/test";

/** Admin console and the forced password change, against a mocked API (the live API is covered by scripts/admin_probe.py). */

type Person = {
  id: number; version: number; code: string; name: string; contactOnFile: boolean; language: string; active: boolean;
  mustChangePassword: boolean; profileCode: string | null; profileName: string | null; administrator: boolean;
  businessLines: string[]; teams: { id: number; name: string }[]; createdOn: string | null;
  awayFrom?: string | null; awayUntil?: string | null;
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
  type EditableRight = { object: string; key: string; managed: boolean; conditional: boolean; read: boolean; write: boolean; create: boolean; remove: boolean; scope: string };
  let editable: { code: string; name: string; version: number; administrator: boolean; roles: string[]; rights: EditableRight[] } =
    { code: "", name: "", version: 0, administrator: false, roles: [], rights: [] };
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
    const action = path.match(/^\/admin\/users\/(\d+)\/(deactivate|activate|password|away)$/);
    if (action && method === "POST") {
      const person = people.find(p => p.id === Number(action[1]))!;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push({ path, body });
      if (action[2] === "away") { person.awayFrom = (body.from as string) || null; person.awayUntil = (body.until as string) || null; }
      if (action[2] === "deactivate") person.active = false;
      if (action[2] === "activate") person.active = true;
      if (action[2] === "password") person.mustChangePassword = true;
      person.version += 1;
      return result(person);
    }
    if (path === "/admin/role-templates") return result({
      templates: [{ code: "SALES_REP", role: "ioeti-sales-rep", nameAr: "مندوب مبيعات", nameEn: "Sales rep" },
        { code: "SALES_MANAGER", role: "ioeti-sales-manager", nameAr: "مدير مبيعات", nameEn: "Sales manager" }],
      recordTypes: [
        { key: "Lead", area: "SALES", nameAr: "العملاء المحتملون", nameEn: "Leads", restricted: false, scopes: ["OWN", "TEAM", "LINE", "ALL"] },
        { key: "Opportunity", area: "SALES", nameAr: "الفرص", nameEn: "Opportunities", restricted: false, scopes: ["OWN", "TEAM", "LINE", "ALL"] },
        { key: "Product", area: "SALES", nameAr: "كتالوج الخدمات", nameEn: "Service catalogue", restricted: false, scopes: ["ALL"] },
        { key: "CandidatePrivateProfile", area: "RECRUITMENT", nameAr: "بيانات المرشح الخاصة", nameEn: "Candidate private data", restricted: true, scopes: ["ALL"] }] });
    if (path === "/admin/profiles" && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push({ path, body });
      profiles.push({ id: 30, code: String(body.code), name: String(body.name), administrator: false, people: 0, rules: 0 });
      editable = { code: String(body.code), name: String(body.name), version: 0, administrator: false, roles: ["ioeti-sales-manager"], rights: [] };
      return result(editable, 201);
    }
    if (path === "/admin/profiles") return result(profiles);
    const rights = path.match(/^\/admin\/profiles\/([^/]+)\/rights$/);
    if (rights && method === "POST") {
      const body = route.request().postDataJSON() as { version: number; object: string; read: boolean; write: boolean; create: boolean; remove: boolean; scope: string };
      posted.push({ path, body });
      if (body.version !== editable.version) return route.fulfill({ status: 409, contentType: "application/json", body: "{}" });
      const others = editable.rights.filter(r => r.key !== body.object);
      const any = body.read || body.write || body.create || body.remove;
      editable = { ...editable, version: editable.version + 1, rights: any ? [...others, { object: "x." + body.object, key: body.object, managed: true, conditional: body.scope !== "ALL",
        read: body.read, write: body.write, create: body.create, remove: body.remove, scope: body.scope }] : others };
      return result(editable);
    }
    if (path === "/admin/profiles/admins") return result({ code: "admins", name: "Administrators", version: 1, administrator: true, roles: ["role.admin"], rights: [] });
    if (path.startsWith("/admin/profiles/") && editable.code && path.endsWith("/" + editable.code)) return result(editable);
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

test("D-07: a profile starts from a template with no rights; each right saves at once with the profile version and its scope", async ({ page }) => {
  const posted = await mockAdmin(page);
  await page.goto("/#/admin/profiles");
  await expect(page.getByText("كل ملف بيبدأ من قالب وظيفة ومن غير أي صلاحيات")).toBeVisible();
  await page.getByRole("button", { name: "ملف جديد" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("القالب").selectOption("SALES_MANAGER");
  await dialog.getByLabel("اسم الملف").fill("مديرو مبيعات القاهرة");
  await dialog.getByLabel("رمز الملف").fill("sales-cairo");
  await dialog.getByRole("button", { name: "إنشاء الملف" }).click();
  expect(posted.find(p => p.path === "/admin/profiles")!.body).toEqual({ code: "sales-cairo", name: "مديرو مبيعات القاهرة", template: "SALES_MANAGER" });
  await expect(page.getByRole("status").filter({ hasText: "اتعمل الملف من غير صلاحيات" })).toBeVisible();
  await expect(page.getByText("ioeti-sales-manager")).toBeVisible();
  const matrix = page.getByRole("table", { name: "صلاحيات مديرو مبيعات القاهرة" });
  // deny by default: nothing ticked
  await expect(matrix.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(matrix.getByRole("row").filter({ hasText: "بيانات المرشح الخاصة" })).toContainText("بيانات مقيدة");
  await matrix.getByRole("checkbox", { name: "قراءة · العملاء المحتملون" }).click();
  await expect(matrix.getByRole("checkbox", { name: "قراءة · العملاء المحتملون" })).toBeChecked();
  await matrix.getByLabel("النطاق · العملاء المحتملون").selectOption("ALL");
  // ticking an action that changes records ticks reading too
  await matrix.getByRole("checkbox", { name: "تعديل · الفرص" }).click();
  await expect(matrix.getByRole("checkbox", { name: "قراءة · الفرص" })).toBeChecked();
  // un-ticking reading clears the rest
  await matrix.getByRole("checkbox", { name: "قراءة · الفرص" }).click();
  await expect(matrix.getByRole("checkbox", { name: "تعديل · الفرص" })).not.toBeChecked();
  const sent = posted.filter(p => p.path === "/admin/profiles/sales-cairo/rights").map(p => p.body);
  expect(sent).toEqual([
    { version: 0, object: "Lead", read: true, write: false, create: false, remove: false, scope: "OWN" },
    { version: 1, object: "Lead", read: true, write: false, create: false, remove: false, scope: "ALL" },
    { version: 2, object: "Opportunity", read: true, write: true, create: false, remove: false, scope: "OWN" },
    { version: 3, object: "Opportunity", read: false, write: false, create: false, remove: false, scope: "OWN" },
  ]);
  // the administrators' profile is shown, not edited
  await page.getByRole("option", { name: /Administrators/ }).click();
  await expect(page.getByText("صلاحية كاملة على المنصة.")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("D-07: with two-step sign-in on, the password alone opens nothing; a wrong code is explained, the right code or a recovery code signs in", async ({ page }) => {
  let signedIn = false;
  const callbacks: Record<string, unknown>[] = [];
  await page.route("**/axelor-erp/callback*", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    callbacks.push({ ...body, client: new URL(route.request().url()).searchParams.get("client_name") });
    const askAgain = () => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ route: { path: "/mfa", state: {} } }) });
    if (body.password) return askAgain();
    if (body.mfaCode === "123456" || body.mfaCode === "ABCD-EFGH") { signedIn = true; return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); }
    return askAgain();
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
  await page.getByLabel("كلمة المرور").fill("Hoda-Own-Pass-2026");
  await page.getByRole("button", { name: /دخول/ }).click();
  await expect(page.getByRole("heading", { name: "الدخول بخطوتين" })).toBeVisible();
  await page.getByLabel("الكود من التطبيق").fill("000000");
  await page.getByRole("button", { name: "تأكيد والدخول" }).click();
  await expect(page.getByRole("alert")).toContainText("الكود مش مطابق");
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toHaveCount(0);
  // no phone: a recovery code
  await page.getByLabel("معاييش الموبايل: هستخدم كود استرجاع").check();
  await page.getByLabel("كود الاسترجاع").fill("ABCD-EFGH");
  await page.getByRole("button", { name: "تأكيد والدخول" }).click();
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
  expect(callbacks).toEqual([
    { username: "hoda.samir", password: "Hoda-Own-Pass-2026", client: null },
    { username: "hoda.samir", mfaCode: "000000", mfaMethod: "TOTP", client: "MfaClient" },
    { username: "hoda.samir", mfaCode: "ABCD-EFGH", mfaMethod: "RECOVERY", client: "MfaClient" },
  ]);
});

test("D-07: two-step sign-in is turned on from Settings with a code, recovery codes are shown once, and turning it off needs a code", async ({ page }) => {
  let enabled = false;
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/axelor-erp/ws/ioeti/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    const result = (object: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "hoda.samir", name: "هدى سمير", language: "ar" }) });
    if (path === "/me/mfa") return result({ enabled, method: enabled ? "TOTP" : null });
    if (method === "POST" && path.startsWith("/me/mfa/")) {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      posted.push({ path, body });
      const invalid = () => route.fulfill({ status: 422, contentType: "application/json",
        body: JSON.stringify({ codeStatus: 422, error: { code: "VALIDATION_FAILED", fields: [{ field: "code", code: "INVALID" }] } }) });
      if (path === "/me/mfa/start") return result({ secret: "JBSWY3DPEHPK3PXP", qrCode: "data:image/png;base64,iVBORw0KGgo=" });
      if (path === "/me/mfa/confirm") {
        if (body.code !== "654321") return invalid();
        enabled = true;
        return result({ status: { enabled: true, method: "TOTP" }, recoveryCodes: ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444", "EEEE-5555"] });
      }
      if (path === "/me/mfa/disable") { enabled = false; return result({ enabled: false, method: null }); }
    }
    if (path === "/marketing/sources") return result([]);
    return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#/settings");
  const card = page.locator(".mfa-card");
  await expect(card).toContainText("مش مفعّل.");
  await card.getByRole("button", { name: "تفعيل بتطبيق مصادقة" }).click();
  await expect(card.getByRole("img", { name: /JBSWY3DPEHPK3PXP/ })).toBeVisible();
  await expect(card).toContainText("JBSWY3DPEHPK3PXP");
  await card.getByLabel("الكود من التطبيق").fill("111111");
  await card.getByRole("button", { name: "تأكيد وتفعيل" }).click();
  await expect(card.getByRole("alert")).toContainText("الكود مش مطابق");
  await card.getByLabel("الكود من التطبيق").fill("654321");
  await card.getByRole("button", { name: "تأكيد وتفعيل" }).click();
  await expect(card).toContainText("مفعّل بتطبيق مصادقة.");
  const codes = card.getByRole("region", { name: "أكواد الاسترجاع" });
  await expect(codes.getByRole("listitem")).toHaveCount(5);
  await codes.getByRole("button", { name: "تمام، حفظتها" }).click();
  await expect(card.getByRole("region", { name: "أكواد الاسترجاع" })).toHaveCount(0);
  await card.getByRole("button", { name: "إيقاف الدخول بخطوتين" }).click();
  await card.getByLabel("استخدم كود استرجاع بدل التطبيق").check();
  await card.getByLabel("كود حالي للتأكيد").fill("AAAA-1111");
  await card.getByRole("button", { name: "تأكيد" }).click();
  await expect(card).toContainText("مش مفعّل.");
  expect(posted.map(p => [p.path, p.body])).toEqual([
    ["/me/mfa/start", {}], ["/me/mfa/confirm", { code: "111111" }], ["/me/mfa/confirm", { code: "654321" }],
    ["/me/mfa/disable", { code: "AAAA-1111", recovery: true }],
  ]);
});

test("D-12: an administrator sets a person's leave; routing skips them then, and clearing it is one click", async ({ page }) => {
  const posted = await mockAdmin(page);
  await page.goto("/#/admin/people/9");
  await expect(page.getByRole("heading", { name: "سارة منصور" })).toBeVisible();
  await expect(page.getByText("مش في إجازة.")).toBeVisible();
  await page.getByRole("button", { name: "تحديد الإجازة" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("مفيش leads بتتوزع عليه");
  await dialog.getByLabel("من يوم").fill("2026-11-01");
  await dialog.getByLabel("لحد يوم").fill("2026-10-30");
  await expect(dialog.getByRole("button", { name: "تحديد الإجازة" })).toBeDisabled(); // the end before the start
  await dialog.getByLabel("لحد يوم").fill("2026-11-05");
  await dialog.getByRole("button", { name: "تحديد الإجازة" }).click();
  await expect(page.locator(".admin-away")).toContainText("2026-11-01 → 2026-11-05");
  expect(posted.find(p => p.path === "/admin/users/9/away")?.body).toEqual({ version: 2, from: "2026-11-01", until: "2026-11-05" });
  await page.getByRole("button", { name: "تحديد الإجازة" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "إلغاء الإجازة" }).click();
  await expect(page.getByText("مش في إجازة.")).toBeVisible();
  expect(posted.filter(p => p.path === "/admin/users/9/away").at(-1)?.body).toEqual({ version: 3, from: "", until: "" });
});
