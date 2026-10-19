// Renders scripts/support/arabic-sample.html to PDF with headless Chromium (the engine behind
// Gotenberg-style external renderers). NODE_PATH="$(npm root -g)" node scripts/support/chromium_pdf_probe.cjs
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.resolve(__dirname, "arabic-sample.html"));
  await page.pdf({ path: path.resolve(__dirname, "../../logs/pdf/chromium-arabic.pdf"), format: "A4" });
  await browser.close();
})();
