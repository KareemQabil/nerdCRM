import { expect, test, type Page, type Route } from "@playwright/test";

/** D-12 lead routing against a mocked API; the live routing is covered by scripts/lead_routing_probe.py. */

const LEAD = { id: 301, version: 2, name: "Hany Fouad", organization: "Delta Mills", stage: "New", stageKind: "OPEN", businessLineCode: "ISO9001",
  assignedToMe: null, receivedAt: "2026-10-27T09:00:00", governorate: "ALEXANDRIA",
  response: { status: "NOT_SET", missing: "CALENDAR", dueAt: null, contactedAt: null, qualification: null, qualifyDueAt: null, qualifiedAt: null } };

async function mock(page: Page, routing: Record<string, unknown> = { outcome: "ASSIGNED", ruleIndex: 0, teamName: "Coast", assigneeName: "Mona", lead: { ...LEAD, assignedToMe: false } }) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/axelor-erp/ws/ioeti/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/ws\/ioeti/, "");
    const method = route.request().method();
    if (method === "POST") posted.push({ path, body: route.request().postDataJSON() ?? {} });
    const result = (object: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ codeStatus: code, messageStatus: "ok", object }) });
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "sara", name: "سارة", language: "ar", administrator: false, policyOwner: true }) });
    if (path === "/business-lines") return result([{ id: 1, code: "ISO9001", nameAr: "أيزو 9001", nameEn: "ISO 9001", status: 2, sequence: 1, responsibleTeam: null }]);
    if (path === "/marketing/sources") return result([{ id: 12, name: "معرض القاهرة" }]);
    if (path === "/marketing/campaigns" || path === "/marketing/saved-views") return result([]);
    if ((path === "/leads" || path === "/marketing/leads") && method === "GET") return result([LEAD]);
    if (path === "/marketing/leads" && method === "POST") return result({ ...LEAD, id: 302, assignedToMe: false }, 201);
    if (path === "/leads/stages") return result([{ id: 1, name: "New", kind: "OPEN" }, { id: 6, name: "Lost", kind: "LOST" }]);
    if (path === "/leads/lost-reasons") return result([]);
    if (path === "/leads/301") return result(LEAD);
    if (path === "/marketing/leads/301/route") return result(routing);
    if (path === "/policies/references") return result({ teams: [{ id: 5, name: "Cairo sales" }, { id: 6, name: "Coast" }], sources: [{ id: 12, name: "معرض القاهرة" }] });
    if (path === "/policies" && method === "GET") return result({ canEdit: true, noOwners: false, policies: [{ key: "leads.routing", decision: "D-12", area: "LEADS",
      scope: "BUSINESS_LINE", allowsDefault: false, titleAr: "توزيع الـ leads", titleEn: "Lead routing", helpAr: "", helpEn: "", inForce: 1 }] });
    if (path === "/policies/owners") return result([{ id: 3, name: "سارة", me: true }]);
    if (path === "/policies/leads.routing" && method === "GET") return result({ key: "leads.routing", decision: "D-12", area: "LEADS", scope: "BUSINESS_LINE",
      allowsDefault: false, titleAr: "توزيع الـ leads", titleEn: "Lead routing", helpAr: "", helpEn: "", canEdit: true, versions: [],
      fields: [{ name: "rules", kind: "LIST", required: true, options: [], min: null, max: 50, titleAr: "قواعد التوزيع (أول قاعدة مطابقة)", titleEn: "Rules", items: [
        { name: "governorate", kind: "CHOICE", required: false, options: ["CAIRO", "ALEXANDRIA"], min: null, max: null, items: [], titleAr: "المحافظة (اختياري)", titleEn: "Governorate" },
        { name: "sourceId", kind: "INTEGER", required: false, options: [], min: null, max: null, items: [], titleAr: "المصدر (اختياري)", titleEn: "Source" },
        { name: "teamId", kind: "INTEGER", required: true, options: [], min: null, max: null, items: [], titleAr: "الفريق", titleEn: "Team" }] },
        { name: "workloadCap", kind: "INTEGER", required: true, options: [], min: 1, max: 1000, items: [], titleAr: "أقصى عدد leads مفتوحة للشخص", titleEn: "Cap" }],
      values: [{ scope: "ISO9001", versionId: 4, value: { rules: [{ governorate: "ALEXANDRIA", teamId: 6 }, { teamId: 5 }], workloadCap: 20 }, since: "2026-10-01",
        nextFrom: null, nextValue: null, nextUnsets: false }] });
    if (path === "/policies/leads.routing" && method === "POST") return result({}, 201);
    return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  });
  return { posted };
}

test("D-12: a new lead records its governorate and, unless kept, goes to the line's routing", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/leads");
  await page.getByRole("button", { name: /عميل محتمل جديد/ }).click();
  const form = page.locator(".mk-intake");
  await form.getByLabel("الاسم أو اسم العائلة").fill("Hany Fouad");
  await form.getByLabel("المحافظة").selectOption("ALEXANDRIA");
  await expect(form.getByText("الـ lead بيتوزع على الفريق بالدور")).toBeVisible();
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect.poll(() => posted.find(p => p.path === "/marketing/leads")?.body).toMatchObject({ governorate: "ALEXANDRIA" });
  expect(posted.find(p => p.path === "/marketing/leads")?.body.keepMine).toBeUndefined();
});

test("D-12: an unassigned lead is routed by the rules from its record, and the outcome is said in words", async ({ page }) => {
  await mock(page);
  await page.goto("/#/leads/301");
  const panel = page.locator(".lead-qualification");
  await expect(panel).toContainText("مش متكلّف بيه حد");
  await expect(panel).toContainText("الإسكندرية");
  await panel.getByRole("button", { name: "توزيع بالقواعد" }).click();
  await expect(panel.getByRole("status")).toHaveText("اتوزع على Mona (Coast).");
});

test("D-12: when nobody can take a lead, the record says it stays unassigned and the manager was told", async ({ page }) => {
  await mock(page, { outcome: "NO_ONE_AVAILABLE", ruleIndex: 1, teamName: "Cairo sales", assigneeName: null, lead: LEAD });
  await page.goto("/#/leads/301");
  await page.locator(".lead-qualification").getByRole("button", { name: "توزيع بالقواعد" }).click();
  await expect(page.locator(".lead-qualification").getByRole("status")).toContainText("مفيش حد متاح في الفريق");
});

test("D-12: the routing rules show teams, sources and governorates by name, and are edited from lists", async ({ page }) => {
  const { posted } = await mock(page);
  await page.goto("/#/policies");
  const values = page.locator(".policies-values");
  await expect(values).toContainText("Coast");
  await expect(values).toContainText("الإسكندرية");
  await expect(values).toContainText("Cairo sales");
  await page.getByRole("button", { name: "تحديد قيمة" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("تنطبق على").selectOption("ISO9001");
  await dialog.getByRole("button", { name: "إضافة" }).click();
  await dialog.getByLabel("المحافظة (اختياري)").first().selectOption("CAIRO");
  await dialog.getByLabel("المصدر (اختياري)").first().selectOption("12");
  await dialog.getByLabel("الفريق").first().selectOption("5");
  await dialog.getByLabel("أقصى عدد leads مفتوحة للشخص").fill("15");
  await dialog.getByLabel("سبب التغيير").fill("توزيع القاهرة");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => posted.find(p => p.path === "/policies/leads.routing")?.body).toMatchObject({
    scope: "ISO9001", value: { rules: [{ governorate: "CAIRO", sourceId: 12, teamId: 5 }], workloadCap: 15 } });
});
