// Browser checks of the IOETI slice in the native Axelor UI (Playwright + Chromium).
// Usage: NODE_PATH="$(npm root -g)" node scripts/ui_smoke_test.cjs
// Requires a running app, the base+crm apps installed (scripts/install_apps.py) and admin/admin
// (dev only, override with IOETI_ADMIN_USER / IOETI_ADMIN_PASSWORD).
// Screenshots and a JSON report are written to logs/ui/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "logs", "ui");
const PORT = (fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^IOETI_APP_PORT=(\d+)/m) || [])[1] || "8080";
const BASE = `http://localhost:${PORT}/axelor-erp`;
const USER = process.env.IOETI_ADMIN_USER || "admin";
const PASSWORD = process.env.IOETI_ADMIN_PASSWORD || "admin";
const results = [];

function check(name, ok, detail = "") {
  results.push({ check: name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`);
}

async function setLanguage(request, lang) {
  const me = await (await request.post(`${BASE}/ws/rest/com.axelor.auth.db.User/search`, {
    data: { data: { _domain: `self.code = '${USER}'` }, fields: ["language"] },
  })).json();
  const user = me.data[0];
  const res = await (await request.post(`${BASE}/ws/rest/com.axelor.auth.db.User/${user.id}`, {
    data: { data: { id: user.id, version: user.version, language: lang } },
  })).json();
  return res.status === 0;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/`);
  await page.locator("input[name=username], input#username").first().fill(USER);
  await page.locator("input[name=password], input#password").first().fill(PASSWORD);
  await page.locator("button[type=submit]").first().click();
  await page.waitForLoadState("networkidle");
  const loggedIn = (await page.locator("input[name=password]").count()) === 0;
  check("login through the web UI", loggedIn);
  await page.screenshot({ path: path.join(OUT, "01-home.png") });

  // IOETI root menu contributed by ioeti-core
  const menuVisible = await page.getByText("IOETI", { exact: true }).first().isVisible().catch(() => false);
  check("IOETI root menu is visible in the navigation", menuVisible);

  // Business line grid (action declared in ioeti-business-lines)
  await page.goto(`${BASE}/#/ds/ioeti-action-business-line-all/list/1`);
  await page.getByText("ISO 22000").first().waitFor({ timeout: 30000 }).catch(() => {});
  const gridText = await page.locator("body").innerText();
  check("business line grid lists the seeded lines with Arabic names",
    gridText.includes("ISO 22000") && gridText.includes("أيزو 22000") && gridText.includes("التدريب"));
  await page.screenshot({ path: path.join(OUT, "02-business-lines-grid.png") });

  // Native opportunity form extended by IOETI (new record)
  await page.goto(`${BASE}/#/ds/crm.my.opportunity/edit/`);
  await page.waitForTimeout(4000);
  const oppText = await page.locator("body").innerText();
  check("native Opportunity form shows the IOETI 'Business line' field", /Business line/.test(oppText));
  await page.screenshot({ path: path.join(OUT, "03-opportunity-form.png") });

  // Arabic UI: switch admin language to ar. The UI locale is fixed when the session starts,
  // so log in again in a fresh browser context, check RTL + translations, then restore English.
  const switched = await setLanguage(context.request, "ar");
  const arContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const arPage = await arContext.newPage();
  await arPage.goto(`${BASE}/`);
  await arPage.locator("input[name=username], input#username").first().fill(USER);
  await arPage.locator("input[name=password], input#password").first().fill(PASSWORD);
  await arPage.locator("button[type=submit]").first().click();
  await arPage.waitForLoadState("networkidle");
  await arPage.goto(`${BASE}/#/ds/ioeti-action-business-line-all/list/1`);
  // wait for grid rows (the tab title appears before the data is loaded)
  await arPage.getByText("نشط").first().waitFor({ timeout: 30000 }).catch(() => {});
  await arPage.waitForLoadState("networkidle");
  const dir = await arPage.evaluate(() => document.documentElement.getAttribute("dir"));
  const arText = await arPage.locator("body").innerText();
  check("Arabic language switches the UI to RTL (after re-login)", switched && dir === "rtl", `dir=${dir}`);
  check("IOETI Arabic translations are applied (خطوط الأعمال, نشط)",
    arText.includes("خطوط الأعمال") && arText.includes("نشط"));
  await arPage.screenshot({ path: path.join(OUT, "04-business-lines-arabic-rtl.png") });
  const untranslated = ["Code", "Status", "Messaging", "Sales"].filter((w) => arText.includes(w));
  check("INFO upstream AOS labels stay English in Arabic mode (AOS ships no ar translations)", true,
    `still English: ${untranslated.join(", ") || "none visible"}`);
  await setLanguage(context.request, "en");

  await browser.close();
  fs.writeFileSync(path.join(OUT, "ui-smoke-test.json"), JSON.stringify({ base: BASE, results }, null, 2));
  const failed = results.filter((r) => r.result !== "PASS").length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
