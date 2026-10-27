import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/** D-12 response targets on leads against a mocked API; the live API is covered by scripts/lead_response_probe.py. */

const response = (status: string, extra: Record<string, unknown> = {}) => ({
  status, missing: null, dueAt: null, contactedAt: null, qualification: null, qualifyDueAt: null, qualifiedAt: null, ...extra,
});
const LEADS = [
  { id: 207, version: 3, name: "Nour Hassan", organization: "Nile View Hotel", stage: "New", stageKind: "OPEN", businessLineCode: "ISO9001",
    assignedToMe: true, receivedAt: "2026-10-22T09:00:00", response: response("OVERDUE", { dueAt: "2026-10-22T13:00:00", qualification: "OVERDUE", qualifyDueAt: "2026-10-23T10:00:00" }) },
  { id: 206, version: 1, name: "Mona Saber", organization: "Delta Foods", stage: "New", stageKind: "OPEN", businessLineCode: "ISO9001",
    assignedToMe: true, receivedAt: "2026-10-27T09:00:00", response: response("DUE", { dueAt: "2026-10-27T13:00:00" }) },
  { id: 205, version: 1, name: "Karim Adel", organization: "Cairo Steel", stage: "New", stageKind: "OPEN", businessLineCode: "TRAINING",
    assignedToMe: true, receivedAt: "2026-10-20T09:00:00", response: response("MET", { dueAt: "2026-10-20T13:00:00", contactedAt: "2026-10-20T10:00:00" }) },
  { id: 204, version: 1, name: "Salma Fathy", organization: "Alex Port", stage: "New", stageKind: "OPEN", businessLineCode: "TRAINING",
    assignedToMe: true, receivedAt: "2026-10-20T09:00:00", response: response("NOT_SET", { missing: "TARGET" }) },
];

async function mockLeads(page: Page) {
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
    if ((path === "/leads" || path === "/marketing/leads") && method === "GET") return result(LEADS);
    if (path === "/marketing/saved-views") return result([]);
    if (path === "/leads/stages") return result([{ id: 1, name: "New", kind: "OPEN" }, { id: 6, name: "Lost", kind: "LOST" }]);
    if (path === "/leads/lost-reasons") return result([]);
    if (path === "/leads/207") return result(LEADS[0]);
    if (path === "/marketing/sources") return result([{ id: 12, name: "معرض القاهرة" }, { id: 13, name: "Website" }]);
    if (path === "/policies/leads.response-target" && method === "GET") return result({ key: "leads.response-target", decision: "D-12", area: "LEADS",
      scope: "BUSINESS_LINE", allowsDefault: true, titleAr: "مواعيد الرد على الـ leads", titleEn: "Lead response targets", helpAr: "", helpEn: "",
      fields: [{ name: "firstContactHours", kind: "INTEGER", required: true, options: [], min: 1, max: 720, items: [], titleAr: "أول تواصل خلال (ساعات عمل)", titleEn: "First contact" },
        { name: "qualificationHours", kind: "INTEGER", required: false, options: [], min: 1, max: 2000, items: [], titleAr: "التأهيل خلال (ساعات عمل)", titleEn: "Qualified" }],
      canEdit: true, values: [{ scope: "ISO9001/12", versionId: 9, value: { firstContactHours: 2 }, since: "2026-10-01", nextFrom: null, nextValue: null, nextUnsets: false }],
      versions: [] });
    if (path === "/policies" && method === "GET") return result({ canEdit: true, noOwners: false, policies: [{ key: "leads.response-target", decision: "D-12", area: "LEADS",
      scope: "BUSINESS_LINE", allowsDefault: true, titleAr: "مواعيد الرد على الـ leads", titleEn: "Lead response targets", helpAr: "", helpEn: "", inForce: 1 }] });
    if (path === "/policies/owners") return result([{ id: 3, name: "سارة", me: true }]);
    if (path === "/policies/leads.response-target" && method === "POST") return result({}, 201);
    return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  });
  return { posted };
}

test("D-12: the lead list shows where each lead stands against its response target, overdue first when sorted", async ({ page }) => {
  await mockLeads(page);
  await page.goto("/#/leads");
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Nour Hassan/ })).toContainText("متأخر");
  await expect(table.getByRole("row", { name: /Mona Saber/ })).toContainText("مستني أول تواصل");
  await expect(table.getByRole("row", { name: /Karim Adel/ })).toContainText("اتواصلنا في الميعاد");
  await expect(table.getByRole("row", { name: /Salma Fathy/ })).toContainText("مفيش هدف رد");
  await table.getByRole("button", { name: "زمن الاستجابة" }).click();
  await expect(table.getByRole("row").nth(1)).toContainText("Nour Hassan");
});

test("D-12: a lead's record shows its deadlines, and says nothing is reassigned automatically", async ({ page }) => {
  await mockLeads(page);
  await page.goto("/#/leads/207");
  const props = page.locator(".lead-qualification .record-properties");
  await expect(props).toContainText("زمن الاستجابة");
  await expect(props).toContainText("متأخر");
  await expect(props).toContainText("أول تواصل قبل");
  await expect(props).toContainText("التأهيل");
  await expect(page.locator(".lead-qualification")).toContainText("مفيش إعادة توزيع تلقائي");
  await expect(page.locator(".lead-qualification")).not.toContainText("D-12");
});

test("D-12: a policy owner sets a response target for a line and one lead source; the value reads with the source's name", async ({ page }) => {
  const { posted } = await mockLeads(page);
  await page.goto("/#/policies");
  const panel = page.locator(".policies-panel");
  await expect(panel.locator(".policies-values")).toContainText("ISO9001 · معرض القاهرة");
  await panel.getByRole("button", { name: "تحديد قيمة" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("مصدر الـ lead (اختياري)")).toBeDisabled(); // a source needs a line first
  await dialog.getByLabel("تنطبق على").selectOption("ISO9001");
  await dialog.getByLabel("مصدر الـ lead (اختياري)").selectOption("13");
  await dialog.getByLabel("أول تواصل خلال (ساعات عمل)").fill("3");
  await dialog.getByLabel("سبب التغيير").fill("الموقع أسرع");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => posted.find(p => p.path === "/policies/leads.response-target")?.body).toMatchObject({ scope: "ISO9001/13", value: { firstContactHours: 3 } });
});

test("D-12: the response chips pass axe's WCAG 2.1 A and AA rules in light and dark", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockLeads(page);
  const found: Record<string, string[]> = {};
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(t => localStorage.setItem("ioeti.ui.preferences.v1", JSON.stringify({ theme: t, language: "ar", density: "comfortable", navigation: "expanded" })), theme);
    await page.goto("/#/leads");
    await expect(page.getByRole("table").getByRole("row", { name: /Nour Hassan/ })).toBeVisible();
    const result = await new AxeBuilder({ page }).include(".response-chip").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const issues = result.violations.map(v => `${v.id}: ${v.nodes.slice(0, 5).map(n => n.target.join(" ")).join(" | ")}`);
    if (issues.length) found[theme] = issues;
  }
  expect(found).toEqual({});
});
