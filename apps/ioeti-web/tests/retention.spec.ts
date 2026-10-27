import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/** D-07 retention review against a mocked API; the live API is covered by scripts/retention_probe.py. */

const iso = (days: number, months = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() + months); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Due = { id: number; label: string; lastActivityOn: string; dueSince: string };

async function mockRetention(page: Page, { owner = true } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const queues: Record<string, Due[]> = {
    LEADS: [{ id: 11, label: "منى عادل", lastActivityOn: iso(-20, -12), dueSince: iso(-20) },
      { id: 12, label: "شركة النيل", lastActivityOn: iso(-5, -12), dueSince: iso(-5) }],
    CONTACTS: [{ id: 21, label: "هاني فؤاد", lastActivityOn: iso(-3, -24), dueSince: iso(-3) }],
  };
  const decisions: Record<string, unknown>[] = [];
  const types = () => [
    { dataType: "LEADS", set: true, months: 12, policyVersionId: 5, since: iso(-60), due: queues.LEADS.length, canAnonymize: true },
    { dataType: "CANDIDATES", set: true, months: 24, policyVersionId: 6, since: iso(-60), due: 0, canAnonymize: true },
    { dataType: "TRAINEES", set: false, months: null, policyVersionId: null, since: null, due: null, canAnonymize: false },
    { dataType: "DONORS", set: false, months: null, policyVersionId: null, since: null, due: null, canAnonymize: false },
    { dataType: "CONTACTS", set: true, months: 24, policyVersionId: 7, since: iso(-60), due: queues.CONTACTS.length, canAnonymize: false },
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
    if (path === "/session") return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "sara", name: "سارة", language: "ar", administrator: true, policyOwner: owner }) });
    if (!path.startsWith("/privacy/retention")) return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    if (!owner) return failure(403, { code: "FORBIDDEN" });
    if (path === "/privacy/retention") return result({ today: iso(0), types: types() });
    if (path === "/privacy/retention/decisions") return result([...decisions].reverse());
    const queue = path.match(/^\/privacy\/retention\/([A-Z]+)$/);
    if (queue) {
      const t = types().find(x => x.dataType === queue[1])!;
      if (!t.set) return failure(422, { code: "POLICY_NOT_SET" });
      return result({ dataType: t.dataType, months: t.months, cutoff: iso(0, -(t.months ?? 0)), total: (queues[t.dataType] ?? []).length,
        canAnonymize: t.canAnonymize, rows: queues[t.dataType] ?? [] });
    }
    const decide = path.match(/^\/privacy\/retention\/([A-Z]+)\/(\d+)\/(keep|anonymize)$/);
    if (decide) {
      const [, type, id, kind] = decide;
      if (!String(body.reason ?? "").trim()) return failure(422, { code: "VALIDATION_FAILED", fields: [{ field: "reason", code: "REQUIRED" }] });
      if (kind === "anonymize" && id === "12") return failure(422, { code: "FILES_FILED" });
      queues[type] = queues[type].filter(r => r.id !== Number(id));
      const d = { id: decisions.length + 1, dataType: type, recordId: Number(id), decision: kind === "keep" ? "KEEP" : "ANONYMIZED", reason: body.reason,
        reviewAgainOn: body.reviewAgainOn ?? null, lastActivityOn: iso(-20, -12), policyVersionId: 5, decidedBy: "سارة منصور", decidedAt: `${iso(0)}T10:00:00` };
      decisions.push(d);
      return result(d);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted };
}

test("D-07: a policy owner reviews records past their retention period: keeps one with a reason, anonymizes another; nothing happens on its own", async ({ page }) => {
  const { posted } = await mockRetention(page);
  await page.goto("/#/retention");
  await expect(page.getByRole("heading", { name: "مراجعة الاحتفاظ بالبيانات", level: 1 })).toBeVisible();
  // every type says where it stands; a type without a period is "not set", never "nothing to review"
  const tiles = page.locator(".retention-types");
  await expect(tiles.getByRole("button", { name: /الـ leads/ })).toContainText("2 سجلات للمراجعة");
  await expect(tiles.getByRole("button", { name: /المتدربين/ })).toContainText("المدة مش مضبوطة");
  await expect(tiles.getByRole("button", { name: /المرشحين/ })).toContainText("مفيش سجلات للمراجعة");
  // the queue opens on the first type with records due; listing it sends nothing
  const table = page.getByRole("table", { name: "السجلات المستحقة للمراجعة" });
  await expect(table.getByRole("row")).toHaveCount(3);
  expect(posted).toHaveLength(0);

  // keep: a reason and a date after today, at most one more period away
  await table.getByRole("row", { name: /منى عادل/ }).getByRole("button", { name: /احتفاظ/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("راجعه تاني يوم")).toHaveAttribute("max", iso(0, 12));
  await expect(dialog.getByLabel("راجعه تاني يوم")).toHaveAttribute("min", iso(1));
  await expect(dialog.getByRole("button", { name: "تأكيد" })).toBeDisabled();
  await dialog.getByLabel("السبب").fill("نزاع مفتوح مع العميل");
  await dialog.getByLabel("راجعه تاني يوم").fill(iso(30));
  await dialog.getByRole("button", { name: "تأكيد" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".retention-page").getByRole("status")).toHaveText("اتسجل الاحتفاظ.");
  expect(posted.at(-1)).toEqual({ path: "/privacy/retention/LEADS/11/keep", body: { reason: "نزاع مفتوح مع العميل", reviewAgainOn: iso(30) } });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(tiles.getByRole("button", { name: /الـ leads/ })).toContainText("سجل واحد للمراجعة");

  // anonymize needs a reason and an explicit "cannot be undone"; a refusal is explained and nothing changes
  await table.getByRole("row", { name: /شركة النيل/ }).getByRole("button", { name: /تجهيل/ }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("الخطوة دي ما ترجعش");
  await dialog.getByLabel("السبب").fill("المدة خلصت");
  await expect(dialog.getByRole("button", { name: "تأكيد" })).toBeDisabled();
  await dialog.getByLabel("فاهم إن التجهيل ما يرجعش").check();
  await dialog.getByRole("button", { name: "تأكيد" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("فيه مستندات مرفوعة على السجل ده؛ ينفع تحتفظ بيه، بس ما ينفعش يتجهّل.");
  await dialog.getByRole("button", { name: "إلغاء" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);

  // shared partner records are kept only: no anonymize button, and the page says why
  await tiles.getByRole("button", { name: /جهات الاتصال/ }).click();
  const contacts = page.getByRole("table", { name: "السجلات المستحقة للمراجعة" });
  await expect(contacts.getByRole("row", { name: /هاني فؤاد/ })).toBeVisible();
  await expect(contacts.getByRole("button", { name: /تجهيل/ })).toHaveCount(0);
  await expect(page.locator(".policies-panel").first()).toContainText("بتتحفظ بس");

  // a type without a period says so and does not offer a queue
  await tiles.getByRole("button", { name: /المتدربين/ }).click();
  await expect(page.getByText(/مالك السياسات يحددها من صفحة السياسات/)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  // the decision log keeps the reason and who decided, by record number (no name is copied into it)
  await expect(page.locator(".policies-history")).toContainText("نزاع مفتوح مع العميل");
  await expect(page.locator(".policies-history")).toContainText("سارة منصور");
  await expect(page.locator(".policies-history")).not.toContainText("منى عادل");
});

test("D-07: the retention review is offered to policy owners only, and the server's refusal is shown", async ({ page }) => {
  await mockRetention(page, { owner: false });
  await page.goto("/#/home");
  await expect(page.getByRole("button", { name: "مراجعة الاحتفاظ" })).toHaveCount(0);
  await page.goto("/#/retention");
  await expect(page.locator(".retention-page").getByRole("alert")).toContainText("المراجعة لمالكي السياسات بس.");
});

test("D-07: the retention review passes axe's WCAG 2.1 A and AA rules in light and dark, and fits a phone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRetention(page);
  const found: Record<string, string[]> = {};
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(t => localStorage.setItem("ioeti.ui.preferences.v1", JSON.stringify({ theme: t, language: "ar", density: "comfortable", navigation: "expanded" })), theme);
    await page.goto("/#/retention");
    await expect(page.getByRole("table", { name: "السجلات المستحقة للمراجعة" })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const issues = result.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 5).map(n => n.target.join(" ")).join(" | ")}`);
    if (issues.length) found[theme] = issues;
  }
  expect(found).toEqual({});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/retention");
  await expect(page.getByRole("table", { name: "السجلات المستحقة للمراجعة" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
