import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Scenario S7: the real web app against a RUNNING Axelor (no mocked API). Skipped unless
 * IOETI_LIVE_FIXTURE names a fixture file from `scripts/live_ui_fixture.py setup`; the fixture's
 * teardown removes everything this test creates. Fictional data only; never run against production.
 */
const fixturePath = process.env.IOETI_LIVE_FIXTURE;
type Fixture = { tag: string; user: string; password: string; lineCode: string; lineNameAr: string; sourceId: number };
const fixture: Fixture | null = fixturePath ? JSON.parse(readFileSync(fixturePath, "utf-8")) : null;

test.skip(!fixture, "set IOETI_LIVE_FIXTURE (scripts/live_ui_fixture.py setup) to run against a live server");
// a retry would meet the first attempt's records (a duplicate, a converted lead): fail once, clearly
test.describe.configure({ mode: "serial", retries: 0 });

function watchServerErrors(page: Page) {
  const failures: string[] = [];
  page.on("response", response => {
    if (response.url().includes("/axelor-erp/") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  return failures;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel(/اسم المستخدم|Username/).fill(fixture!.user);
  await page.getByLabel(/كلمة المرور|Password/).fill(fixture!.password);
  await page.locator("form.login-form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: /^مرحبًا/ })).toBeVisible();
}

async function documentFits(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test("live: sign in, record a lead, catch its Arabic duplicate, convert it and open the account", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  const { tag } = fixture!;
  const organization = `مؤسسة الهدى ${tag}`;
  await signIn(page);

  await page.goto("/#/leads");
  await page.getByRole("button", { name: "عميل محتمل جديد" }).click();
  let form = page.locator(".mk-intake");
  await form.getByLabel("الاسم أو اسم العائلة").fill("عبد الله");
  await form.getByLabel("الاسم الأول").fill("أحمد");
  await form.getByLabel("الجهة").fill(organization);
  await form.getByLabel("البريد الإلكتروني").fill(`ahmed.${tag.toLowerCase()}@example.test`);
  await form.getByLabel("المصدر").selectOption(String(fixture!.sourceId));
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await expect(page).toHaveURL(/#\/leads\/\d+$/);
  const leadId = Number(page.url().split("/").at(-1));

  // the same person, spelled differently: the server finds it before anything is recorded
  await page.goto("/#/leads");
  await page.getByRole("button", { name: "عميل محتمل جديد" }).click();
  form = page.locator(".mk-intake");
  await form.getByLabel("الاسم أو اسم العائلة").fill("عبد اللّه");
  await form.getByLabel("الاسم الأول").fill("احمد");
  await form.getByLabel("الجهة").fill(`موسسه الهدي ${tag}`);
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  const review = page.getByRole("region", { name: "عملاء محتملون مشابهون ضمن نطاقك" });
  await expect(review.getByRole("link", { name: "فتح" })).toHaveAttribute("href", `#/leads/${leadId}`);
  await expect(page.getByRole("button", { name: "تسجيل", exact: true })).toBeDisabled();

  await page.goto(`/#/leads/${leadId}`);
  await page.getByRole("link", { name: "تحويل إلى حساب وفرصة" }).click();
  await expect(page.getByLabel("اسم الفرصة التجارية")).toHaveValue(organization);
  await page.getByLabel("خط الأعمال").selectOption(fixture!.lineCode);
  await page.getByRole("button", { name: "تحويل", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تم التحويل" })).toBeVisible();
  await page.getByRole("link", { name: "فتح الحساب" }).click();
  await expect(page).toHaveURL(/#\/accounts\/\d+$/);
  await expect(page.locator(".record-workspace h1")).toHaveText(organization);
  await expect(page.getByRole("tab", { name: /الفرص التجارية \(1\)/ })).toBeVisible();

  await page.goto(`/#/leads/${leadId}`);
  await expect(page.getByRole("link", { name: "تحويل إلى حساب وفرصة" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "فتح الفرصة" })).toBeVisible();
  expect(serverErrors).toEqual([]);
});

test("live: the same pages fit a 390 px phone with real data", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  for (const route of ["/#/leads", "/#/accounts", "/#/opportunities", "/#/reports", "/#/inbox", "/#/settings"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(await documentFits(page), `${route} scrolls sideways at 390 px`).toBe(true);
  }
  await page.goto("/#/accounts");
  await page.locator("article", { hasText: fixture!.tag }).getByRole("button", { name: "عرض التفاصيل" }).click();
  await expect(page.locator(".record-workspace h1")).toContainText(fixture!.tag);
  await page.waitForLoadState("networkidle");
  expect(await documentFits(page), "account record scrolls sideways at 390 px").toBe(true);
  expect(serverErrors).toEqual([]);
});
