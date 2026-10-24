import { expect, test, type Page, type Route } from "@playwright/test";

/** The visit checklist against a mocked API; the live API is covered by scripts/visit_checklist_probe.py. */

type Item = Record<string, unknown> & { id: number; version: number; type: string; required: boolean; active: boolean; answered: boolean };

async function mockChecklist(page: Page, { status = "STARTED" } = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const visit = { id: 1, version: 3, reference: "VIS-0001", status, purpose: "زيارة تقييم", accountId: 7, accountName: "مصنع النور", type: "زيارة تقييم",
    assigneeId: 3, assigneeName: "سارة", mine: true, plannedStart: "2026-10-25T10:00:00Z", plannedEnd: null, startedAt: null, finishedAt: null,
    durationSeconds: null, opportunityId: null, contractId: null };
  const base = { hint: null, answerable: true, unit: null, checkboxLabel: null, indicationText: null, choices: [], choiceId: null, text: null, date: null,
    measure: null, checked: null, hasFile: false, nonConforming: false };
  const items: Item[] = [
    { ...base, id: 11, version: 0, title: "حالة خط الإنتاج", type: "list", required: true, active: true, answered: false,
      choices: [{ id: 1, name: "مطابق", nonConforming: false }, { id: 2, name: "غير مطابق", nonConforming: true }] },
    { ...base, id: 12, version: 0, title: "سبب عدم المطابقة", type: "text", required: true, active: false, answered: false },
    { ...base, id: 13, version: 0, title: "درجة حرارة المخزن", type: "measure", required: false, active: true, answered: false, unit: "°C" },
    { ...base, id: 14, version: 0, title: "معدات الوقاية متاحة", type: "checkbox", required: false, active: true, answered: false, checkboxLabel: "متاحة" },
    { ...base, id: 15, version: 0, title: "توقيع ممثل العميل", type: "signature", required: true, active: true, answered: false },
    { ...base, id: 16, version: 0, title: "تعليمات السلامة", type: "indication", required: false, active: true, answered: false, answerable: false, indicationText: "البس الخوذة قبل الدخول" },
  ];
  const view = () => ({ available: true, generated: true, generating: false, canAnswer: visit.status === "STARTED" || visit.status === "SUSPENDED",
    requiredOpen: items.filter(i => i.required && i.active && !i.answered).length, message: null, sections: [{ id: 100, title: "زيارة تقييم", items }] });
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
    if (path === "/visits/1") return result({ visit, log: [] });
    if (path === "/visits/1/checklist") return result(view());
    if (path === "/content/documents") return result([]);
    const finish = path === "/visits/1/finish";
    if (finish) {
      if (view().requiredOpen > 0) return failure(422, { code: "CHECKLIST_INCOMPLETE", fields: [] });
      Object.assign(visit, { status: "FINISHED", version: visit.version + 1 });
      return result(visit);
    }
    const answer = path.match(/^\/visits\/1\/checklist\/(\d+)(\/file)?$/);
    if (answer) {
      const item = items.find(i => i.id === Number(answer[1]))!;
      if (body.version !== item.version) return failure(409, { code: "CONFLICT", fields: [] });
      if (answer[2]) Object.assign(item, { hasFile: true, answered: true });
      else if (body.clear) Object.assign(item, { choiceId: null, text: null, measure: null, checked: null, hasFile: false, answered: false, nonConforming: false });
      else if (item.type === "list") {
        const choice = (item.choices as { id: number; nonConforming: boolean }[]).find(c => c.id === body.choiceId)!;
        Object.assign(item, { choiceId: choice.id, answered: true, nonConforming: choice.nonConforming });
        items[1].active = choice.nonConforming;
      } else Object.assign(item, { text: body.text ?? item.text, measure: body.measure ?? item.measure, checked: body.checked ?? item.checked, answered: true });
      item.version += 1;
      return result(view());
    }
    if (/\/visits\/1\/checklist\/\d+\/file$/.test(path)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return { posted, items };
}

test("the visit checklist: answers by type, a non-conforming answer brings its follow-up question, required items gate the finish", async ({ page }) => {
  const { posted } = await mockChecklist(page);
  await page.goto("/#/visits/1");
  const checklist = page.getByRole("region", { name: "قائمة التحقق" });
  await expect(checklist.getByRole("status")).toHaveText("فاضل 2 أسئلة مطلوبة قبل إنهاء الزيارة.");
  await expect(page.locator(".visit-finish-blocked")).toContainText("فاضل 2 أسئلة مطلوبة في قائمة التحقق");
  await expect(checklist.getByText("سبب عدم المطابقة")).toHaveCount(0);
  await expect(checklist.getByText("البس الخوذة قبل الدخول")).toBeVisible();

  await checklist.getByRole("radio", { name: "غير مطابق" }).click();
  await expect(checklist.getByRole("radio", { name: "غير مطابق" })).toHaveAttribute("aria-checked", "true");
  await expect(checklist.locator(".visit-check-item.is-nonconforming")).toContainText("غير مطابق");
  const why = checklist.locator(".visit-check-item").filter({ hasText: "سبب عدم المطابقة" });
  await expect(why).toBeVisible();
  await why.getByRole("textbox").fill("الخط متوقف للصيانة");
  await why.getByRole("button", { name: "حفظ" }).click();
  await expect(why).toHaveClass(/is-answered/);

  const temp = checklist.locator(".visit-check-item").filter({ hasText: "درجة حرارة المخزن" });
  await expect(temp.getByText("°C")).toBeVisible();
  await temp.getByRole("spinbutton").fill("23.5");
  await temp.getByRole("button", { name: "حفظ" }).click();
  // the box follows the saved answer, so it turns on once the server has stored it
  await checklist.getByRole("checkbox", { name: "متاحة", exact: true }).click();
  await expect(checklist.getByRole("checkbox", { name: "متاحة", exact: true })).toBeChecked();

  // the finish is refused by the server while the signature is missing, and explained
  await page.getByRole("button", { name: "إنهاء الزيارة" }).click();
  await expect(page.getByRole("alert").first()).toContainText("جاوب أسئلة قائمة التحقق المطلوبة الأول.");

  // sign with real pointer strokes on the pad, then use the signature
  const pad = checklist.locator(".visit-check-signature canvas");
  await expect(checklist.getByRole("button", { name: "اعتماد التوقيع" })).toBeDisabled();
  await pad.scrollIntoViewIfNeeded(); // mouse strokes are in viewport coordinates
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
  await page.mouse.move(box.x + 200, box.y + 50, { steps: 8 });
  await page.mouse.up();
  await checklist.getByRole("button", { name: "اعتماد التوقيع" }).click();
  await expect(checklist.getByRole("status")).toHaveText("كل الأسئلة المطلوبة اتجاوبت.");
  await expect(page.locator(".visit-finish-blocked")).toHaveCount(0);
  const signature = posted.find(p => p.path === "/visits/1/checklist/15/file")!;
  expect(signature.body.fileName).toBe("signature.png");
  expect(String(signature.body.contentBase64).slice(0, 8)).toBe("iVBORw0K"); // a PNG
  await page.getByRole("button", { name: "إنهاء الزيارة" }).click();
  await expect(page.locator(".visit-hero .visit-status")).toHaveText("خلصت");
  await expect(checklist.getByText("الإجابات بتتعدل وانت في الموقع بس.")).toBeVisible();
  const answers = posted.filter(p => p.path.startsWith("/visits/1/checklist/"));
  expect(answers.every(p => typeof p.body.version === "number")).toBe(true);
});

test("before the visit starts the checklist is read-only, with no answer controls enabled", async ({ page }) => {
  await mockChecklist(page, { status: "PLANNED" });
  await page.goto("/#/visits/1");
  const checklist = page.getByRole("region", { name: "قائمة التحقق" });
  await expect(checklist.getByText("الإجابات بتتعدل وانت في الموقع بس.")).toBeVisible();
  await expect(checklist.getByRole("radio", { name: "مطابق", exact: true })).toBeDisabled();
  await expect(checklist.getByRole("spinbutton")).toBeDisabled();
});
