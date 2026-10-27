import { expect, test, type Page, type Route } from "@playwright/test";

/** Business-rule policies against a mocked API; the live API is covered by scripts/policy_probe.py. */

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const DEFS = {
  "finance.tax": { decision: "D-06", area: "FINANCE", scope: "BUSINESS_LINE", allowsDefault: true, titleAr: "ضريبة الخدمات", titleEn: "Tax on services",
    fields: [{ name: "ratePercent", kind: "PERCENT", required: true, titleAr: "نسبة الضريبة", titleEn: "Tax rate" },
      { name: "name", kind: "TEXT", required: true, max: 60, titleAr: "اسم الضريبة", titleEn: "Tax name" }] },
  "sales.quote-approval": { decision: "D-11", area: "SALES", scope: "BUSINESS_LINE", allowsDefault: true, titleAr: "موافقة عروض الأسعار", titleEn: "Quotation approval",
    fields: [{ name: "tiers", kind: "LIST", required: true, max: 5, titleAr: "مستويات الموافقة (من الأصغر للأكبر)", titleEn: "Approval tiers", items: [
      { name: "maxDiscountPercent", kind: "PERCENT", required: true, titleAr: "حتى خصم %", titleEn: "Up to discount %" },
      { name: "approver", kind: "CHOICE", required: true, options: ["NONE", "SALES_MANAGER", "GM"], titleAr: "مين يوافق", titleEn: "Approved by" }] }] },
} as Record<string, Record<string, unknown>>;

function field(f: Record<string, unknown>): Record<string, unknown> {
  return { options: [], min: null, max: null, items: [], ...f, ...(f.items ? { items: (f.items as Record<string, unknown>[]).map(field) } : {}) };
}

async function mockPolicies(page: Page, { owner = true, noOwners = false } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const versions: Record<string, Record<string, unknown>[]> = { "finance.tax": [], "sales.quote-approval": [] };
  let owners = noOwners ? [] : [{ id: 3, name: "سارة منصور", me: owner }];
  const detail = (key: string) => {
    const d = DEFS[key];
    const vs = versions[key];
    const scopes = [...new Set(vs.map(v => v.scope as string | null))];
    return { key, ...d, helpAr: "مساعدة", helpEn: "help", fields: (d.fields as Record<string, unknown>[]).map(field), canEdit: owner && !noOwners,
      values: scopes.map(scope => {
        const own = vs.filter(v => v.scope === scope);
        const now = own.filter(v => String(v.effectiveFrom) <= iso(0)).at(-1);
        const next = own.find(v => String(v.effectiveFrom) > iso(0));
        return { scope, versionId: now && !now.retired ? now.id : null, value: now && !now.retired ? now.value : null, since: now?.effectiveFrom ?? null,
          nextFrom: next?.effectiveFrom ?? null, nextValue: next && !next.retired ? next.value : null, nextUnsets: !!next?.retired };
      }), versions: [...vs].reverse() };
  };
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
      body: JSON.stringify({ code: "sara", name: "سارة", language: "ar", administrator: !owner || noOwners, policyOwner: owner && !noOwners }) });
    if (path === "/business-lines" || path === "/opportunities/stages") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if (path === "/policies") return result({ canEdit: owner && !noOwners, noOwners, policies: Object.entries(DEFS).map(([key, d]) => ({ key, decision: d.decision, area: d.area,
      scope: d.scope, allowsDefault: d.allowsDefault, titleAr: d.titleAr, titleEn: d.titleEn, helpAr: "", helpEn: "",
      inForce: detail(key).values.filter(v => v.value).length })) });
    if (path === "/policies/owners" && method === "GET") return result(owners);
    if (path === "/policies/people") return result([{ id: 3, name: "سارة منصور", me: true }, { id: 8, name: "كريم حسن", me: false }]);
    if (path === "/policies/owners" && method === "POST") { owners = [...owners, { id: Number(body.userId), name: body.userId === 8 ? "كريم حسن" : "سارة منصور", me: false }]; return result(owners); }
    if (path === "/policies/references") return result({ teams: [], sources: [] });
    if (path === "/policies/recommended") return result({ canApply: owner && !noOwners, recommendations: [
      { id: "finance.tax|", key: "finance.tax", decision: "D-06", area: "FINANCE", titleAr: "ضريبة الخدمات", titleEn: "Tax on services", scope: null, scopeLabel: null,
        value: { ratePercent: 14, name: "ضريبة القيمة المضافة 14%", type: "VAT" }, basis: "FACT", whyAr: "14% هي النسبة العامة لضريبة القيمة المضافة في مصر.", whyEn: "",
        current: detail("finance.tax").values.find(v => v.scope === null)?.value ?? null, fields: (DEFS["finance.tax"].fields as Record<string, unknown>[]).map(field) },
      { id: "sales.quote-approval|", key: "sales.quote-approval", decision: "D-11", area: "SALES", titleAr: "موافقة عروض الأسعار", titleEn: "Quotation approval", scope: null,
        scopeLabel: null, value: { tiers: [{ maxDiscountPercent: 5, approver: "NONE" }, { maxDiscountPercent: 10, approver: "SALES_MANAGER" }] }, basis: "PRACTICE",
        whyAr: "خصم لحد 5% من غير موافقة.", whyEn: "", current: null, fields: (DEFS["sales.quote-approval"].fields as Record<string, unknown>[]).map(field) },
    ] });
    if (path === "/policies/recommended/apply") {
      const ids = body.ids as string[];
      if (ids.includes("finance.tax|")) versions["finance.tax"].push({ id: 900, scope: null, value: { ratePercent: 14, name: "ضريبة القيمة المضافة 14%", type: "VAT" },
        retired: false, effectiveFrom: body.effectiveFrom ?? iso(0), reason: "Recommended starting value (R1)", authorName: "سارة منصور", createdAt: "2026-10-27T10:00:00" });
      return result({ applied: ids });
    }
    const one = path.match(/^\/policies\/([a-z.-]+)(\/retire)?$/);
    if (one && method === "GET") return result(detail(one[1]));
    if (one && method === "POST") {
      if (!String(body.reason ?? "").trim()) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "reason", code: "REQUIRED" }] });
      const value = body.value as Record<string, unknown> | undefined;
      if (one[1] === "finance.tax" && !one[2] && Number(value?.ratePercent) > 100) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "value.ratePercent", code: "RANGE" }] });
      versions[one[1]].push({ id: 100 + versions[one[1]].length, scope: body.scope ?? null, value: one[2] ? null : value, retired: !!one[2],
        effectiveFrom: body.effectiveFrom ?? iso(0), reason: body.reason, authorName: "سارة منصور", createdAt: "2026-10-25T10:00:00" });
      return result(detail(one[1]), one[2] ? 200 : 201);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted };
}

test("a policy owner sets the tax, schedules a change, and sees who changed what and why; a bad value is explained", async ({ page }) => {
  const { posted } = await mockPolicies(page);
  await page.goto("/#/policies");
  await expect(page.getByRole("heading", { name: "السياسات وقواعد العمل", level: 1 })).toBeVisible();
  const tax = page.getByRole("button", { name: /ضريبة الخدمات/ });
  await expect(tax).toContainText("مش مضبوطة — العمليات اللي محتاجاها مرفوضة");
  await tax.click();
  const panel = page.locator(".policies-panel");
  await expect(panel.getByText("لسه مفيش قيمة.")).toBeVisible();
  await panel.getByRole("button", { name: "تحديد قيمة" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("تنطبق على")).toHaveValue(""); // the default value for every line
  await dialog.getByLabel("نسبة الضريبة").fill("140");
  await dialog.getByLabel("اسم الضريبة").fill("ضريبة القيمة المضافة");
  await expect(dialog.getByRole("button", { name: "حفظ" })).toBeDisabled(); // a reason is required
  await dialog.getByLabel("سبب التغيير").fill("قرار المالك");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  // the browser refuses a rate above 100% before anything is sent (the server checks it again)
  expect(await dialog.getByLabel("نسبة الضريبة").evaluate(e => (e as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  expect(posted.filter(p => p.path === "/policies/finance.tax")).toHaveLength(0);
  await dialog.getByLabel("نسبة الضريبة").fill("14");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.locator(".policies-values")).toContainText("14%");
  await expect(panel.locator(".policies-values")).toContainText("القيمة العامة");
  await expect(tax).toContainText("قيمة سارية");
  expect(posted.at(-1)).toMatchObject({ path: "/policies/finance.tax", body: { value: { ratePercent: 14, name: "ضريبة القيمة المضافة" }, reason: "قرار المالك" } });

  // a change from a later date shows as the next value, and the history keeps who and why
  await panel.getByRole("button", { name: "تحديد قيمة" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("نسبة الضريبة").fill("10");
  await dialog.getByLabel("اسم الضريبة").fill("ضريبة القيمة المضافة");
  await dialog.getByLabel("سارية من").fill(iso(10));
  await dialog.getByLabel("سبب التغيير").fill("تعديل مجدول");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(panel.locator(".policies-next")).toContainText(iso(10));
  await panel.getByText(/السجل/).click();
  await expect(panel.locator(".policies-history li")).toHaveCount(2);
  await expect(panel.locator(".policies-history")).toContainText("تعديل مجدول");
});

test("approval tiers are edited as rows, per business line", async ({ page }) => {
  const { posted } = await mockPolicies(page);
  await page.goto("/#/policies");
  await page.getByRole("button", { name: /موافقة عروض الأسعار/ }).click();
  await page.locator(".policies-panel").getByRole("button", { name: "تحديد قيمة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("تنطبق على").selectOption({ label: "أيزو 9001 (ISO9001)" });
  await dialog.getByRole("button", { name: "إضافة" }).click();
  await dialog.getByRole("button", { name: "إضافة" }).click();
  const rows = dialog.locator(".policies-list-row");
  await rows.nth(0).getByLabel("حتى خصم %").fill("5");
  await rows.nth(0).getByLabel("مين يوافق").selectOption({ label: "من غير موافقة" });
  await rows.nth(1).getByLabel("حتى خصم %").fill("20");
  await rows.nth(1).getByLabel("مين يوافق").selectOption({ label: "مدير المبيعات" });
  await dialog.getByLabel("سبب التغيير").fill("حدود الموافقة لخط الأيزو");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page.locator(".policies-values")).toContainText("ISO9001");
  await expect(page.locator(".policies-values")).toContainText("مدير المبيعات");
  expect(posted.at(-1)!.body).toMatchObject({ scope: "ISO9001",
    value: { tiers: [{ maxDiscountPercent: 5, approver: "NONE" }, { maxDiscountPercent: 20, approver: "SALES_MANAGER" }] } });
});

test("with no policy owner yet, an administrator sees why nothing can change and appoints the first owner", async ({ page }) => {
  const { posted } = await mockPolicies(page, { owner: false, noOwners: true });
  await page.goto("/#/policies");
  const owners = page.getByRole("region", { name: "مفيش مالك سياسات لسه" });
  await expect(owners).toContainText("تقدر تعيّن أول مالك");
  await page.getByRole("button", { name: /ضريبة الخدمات/ }).click();
  await expect(page.locator(".policies-panel").getByRole("button", { name: "تحديد قيمة" })).toHaveCount(0);
  await owners.getByLabel("الشخص").selectOption({ label: "كريم حسن" });
  await owners.getByRole("button", { name: "تعيين" }).click();
  await expect(page.locator(".policies-owner-list")).toContainText("كريم حسن");
  expect(posted.at(-1)).toEqual({ path: "/policies/owners", body: { userId: 8 } });
});

test("R1: a policy owner reviews the recommended starting values with their reasons and applies the chosen ones in one step", async ({ page }) => {
  const { posted } = await mockPolicies(page);
  await page.goto("/#/policies");
  const panel = page.locator(".policies-recommended");
  await expect(panel).toContainText("2 من 2 قاعدة لسه مالهاش قيمة");
  await panel.getByRole("button", { name: "راجع القيم المقترحة" }).click();
  const dialog = page.getByRole("dialog");
  const tax = dialog.locator(".policies-rec", { hasText: "ضريبة الخدمات" });
  await expect(tax).toContainText("14%");
  await expect(tax).toContainText("مبني على قانون أو معيار");
  await expect(tax).toContainText("بيشغّل: ضريبة عروض الأسعار والفواتير");
  await expect(dialog.locator(".policies-rec", { hasText: "موافقة عروض الأسعار" })).toContainText("مدير المبيعات");
  // keep the approval tiers for later: apply the tax only
  await dialog.locator(".policies-rec", { hasText: "موافقة عروض الأسعار" }).getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "تطبيق قيمة واحدة" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel).toContainText("اتطبّقت 1 قيمة.");
  expect(posted.find(p => p.path === "/policies/recommended/apply")!.body).toEqual({ ids: ["finance.tax|"], effectiveFrom: iso(0) });
  await expect(page.getByRole("button", { name: /ضريبة الخدمات/ })).toContainText("قيمة سارية");
  // what is already set shows as set and cannot be chosen again
  await panel.getByRole("button", { name: "راجع القيم المقترحة" }).click();
  await expect(page.getByRole("dialog").locator(".policies-rec.is-set")).toContainText("مضبوطة بالفعل:");
  await expect(page.getByRole("dialog").locator(".policies-rec.is-set").getByRole("checkbox")).toHaveCount(0);
});

test("R1: someone who is not a policy owner sees the recommendations but cannot apply them", async ({ page }) => {
  await mockPolicies(page, { owner: false });
  await page.goto("/#/policies");
  const panel = page.locator(".policies-recommended");
  await expect(panel).toContainText("التطبيق لمالكي السياسات بس.");
  await panel.getByRole("button", { name: "راجع القيم المقترحة" }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: /تطبيق/ })).toHaveCount(0);
});
