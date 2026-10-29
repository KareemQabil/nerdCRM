import { expect, test } from "@playwright/test";

// REAL HTTPS Axelor; test-only pilot fixtures, read-only actions apart from login/logout.
// Do not run against actual customer records, a production backend or the public fictional demo.
test.describe.serial("IOETI authenticated staging pilot smoke", () => {
  test("anonymous users cannot fetch session or business-line DTOs", async ({ request }) => {
    for (const path of ["/axelor-erp/ws/ioeti/session", "/axelor-erp/ws/ioeti/business-lines"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect([401, 403], path + " must deny anonymous access").toContain(response.status());
    }
  });

  test("fictional pilot user signs in, visits sales and leads, and signs out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("form.login-form")).toBeVisible();
    await page.getByLabel(/اسم المستخدم|Username/i).fill(process.env.IOETI_PILOT_USER!);
    await page.getByLabel(/كلمة المرور|Password/i).fill(process.env.IOETI_PILOT_PASSWORD!);
    await page.locator('form.login-form button[type="submit"]').click();
    const signOut = page.getByRole("button", { name: /تسجيل الخروج|Sign out/i });
    await expect(signOut).toBeVisible({ timeout: 20_000 });

    const session = await page.request.get("/axelor-erp/ws/ioeti/session", { maxRedirects: 0 });
    expect(session.status(), "authenticated session DTO").toBe(200);

    await page.goto("/#/opportunities");
    await expect(page).toHaveURL(/#\/opportunities$/);
    await expect(signOut).toBeVisible();

    await page.goto("/#/leads");
    await expect(page).toHaveURL(/#\/leads$/);
    await expect(signOut).toBeVisible();

    const generic = await page.request.get("/axelor-erp/ws/rest/com.axelor.apps.crm.db.Opportunity", { maxRedirects: 0 });
    expect([403, 404], "normal sales user must not receive native unrestricted REST").toContain(generic.status());

    await signOut.click();
    await expect(page.locator("form.login-form")).toBeVisible();
    const invalidated = await page.request.get("/axelor-erp/ws/ioeti/session", { maxRedirects: 0 });
    expect([401, 403], "logout must invalidate the server session").toContain(invalidated.status());
  });
});
