import { expect, test, type Page, type Route } from "@playwright/test";

/** Campaigns against a mocked API; the live API is covered by scripts/campaign_probe.py. */

const NEXT: Record<string, string[]> = { DRAFT: ["PLANNED"], PLANNED: ["DRAFT", "STARTED"], STARTED: ["SUSPENDED", "ENDED"], SUSPENDED: ["STARTED", "ENDED"], ENDED: [] };

async function mockCampaigns(page: Page) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const campaigns = [
    { id: 1, version: 3, name: "معرض القاهرة للجودة", stage: "PLANNED", typeId: 5, type: "معرض", startDate: "2026-11-01", endDate: "2026-11-30",
      summary: "حملة المعرض السنوي", ownerName: "سارة منصور", leads: 12, converted: 4, opportunities: 3 },
    { id: 2, version: 0, name: "ندوة أيزو 45001", stage: "DRAFT", typeId: null, type: null, startDate: null, endDate: null, summary: null, ownerName: "سارة منصور",
      leads: 0, converted: 0, opportunities: 0 },
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
    if (path === "/campaigns/types") return result([{ id: 5, name: "معرض" }, { id: 6, name: "ندوة" }]);
    if (path === "/campaigns" && method === "GET") return result(campaigns);
    if (path === "/campaigns" && method === "POST") {
      const added = { id: 9, version: 0, name: String(body.name), stage: "DRAFT", typeId: Number(body.typeId) || null, type: body.typeId === 6 ? "ندوة" : null,
        startDate: (body.startDate as string) || null, endDate: (body.endDate as string) || null, summary: null, ownerName: "سارة", leads: 0, converted: 0, opportunities: 0 };
      campaigns.push(added);
      return result(added, 201);
    }
    const stage = path.match(/^\/campaigns\/(\d+)\/stage$/);
    if (stage) {
      const c = campaigns.find(x => x.id === Number(stage[1]))!;
      if (body.version !== c.version) return failure(409, { code: "CONFLICT", fields: [] });
      if (!NEXT[c.stage].includes(String(body.stage))) return failure(422, { code: "STAGE_NOT_ALLOWED", fields: [] });
      Object.assign(c, { stage: body.stage, version: c.version + 1 });
      return result(c);
    }
    const one = path.match(/^\/campaigns\/(\d+)$/);
    if (one && method === "GET") {
      const c = campaigns.find(x => x.id === Number(one[1]))!;
      return result({ campaign: c, leads: c.id === 1 ? [{ id: 50, name: "أحمد عادل", converted: true, stage: "Converted" }, { id: 51, name: "منى سمير", converted: false, stage: "New" }] : [] });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, campaigns };
}

test("the campaign board: drag a campaign to an allowed stage; a refused move is explained and undone", async ({ page }) => {
  const { posted } = await mockCampaigns(page);
  await page.goto("/#/campaigns");
  await expect(page.getByRole("heading", { name: "الحملات", level: 1 })).toBeVisible();
  const planned = page.getByRole("region", { name: "مخططة" });
  const running = page.getByRole("region", { name: "شغالة" });
  const ended = page.getByRole("region", { name: "انتهت" });
  await expect(planned.locator(".campaign-card")).toHaveCount(1);
  await expect(planned).toContainText("12");
  await expect(page.getByText(/D-10/)).toBeVisible();
  const card = planned.locator(".campaign-card").first();
  // planned → ended is not allowed: explained, nothing sent, the card stays
  await card.hover(); await page.mouse.down();
  const endBox = (await ended.boundingBox())!;
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("مينفعش الحملة تنتقل");
  await expect(planned.locator(".campaign-card")).toHaveCount(1);
  expect(posted).toHaveLength(0);
  // planned → running is allowed
  await card.hover(); await page.mouse.down();
  const runBox = (await running.boundingBox())!;
  await page.mouse.move(runBox.x + runBox.width / 2, runBox.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(running.locator(".campaign-card")).toHaveCount(1);
  await expect(page.locator(".campaigns-notice")).toContainText("بقت شغالة");
  expect(posted[0]).toEqual({ path: "/campaigns/1/stage", body: { version: 3, stage: "STARTED" } });
});

test("keyboard and phone users move a campaign with its picker; a new campaign opens on its page with results", async ({ page }) => {
  const { posted } = await mockCampaigns(page);
  await page.goto("/#/campaigns");
  await page.getByRole("combobox", { name: "نقل إلى: ندوة أيزو 45001" }).selectOption("PLANNED");
  await expect(page.getByRole("region", { name: "مخططة" }).locator(".campaign-card")).toHaveCount(2);
  expect(posted[0].body).toEqual({ version: 0, stage: "PLANNED" });
  await page.getByRole("button", { name: "حملة جديدة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("اسم الحملة").fill("ندوة السلامة المهنية");
  await dialog.getByLabel("نوع الحملة").selectOption({ label: "ندوة" });
  await dialog.getByLabel("من").fill("2026-12-01");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/#\/campaigns\/9$/);
  await expect(page.getByRole("heading", { name: "ندوة السلامة المهنية" })).toBeVisible();
  expect(posted[1].body).toMatchObject({ name: "ندوة السلامة المهنية", typeId: 6, startDate: "2026-12-01" });
  await page.goto("/#/campaigns/1");
  await expect(page.locator(".campaign-funnel li")).toHaveCount(3);
  await expect(page.locator(".campaign-funnel")).toContainText("12");
  await expect(page.getByRole("link", { name: "أحمد عادل" })).toHaveAttribute("href", "#/leads/50");
  await expect(page.locator(".campaign-record")).not.toContainText(/ROI|إيراد متوقع/);
});
