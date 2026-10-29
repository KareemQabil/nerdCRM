import { defineConfig, devices } from "@playwright/test";

// Separate from the mocked API and fictional demo suites. Never run against production.
const origin = process.env.IOETI_STAGING_ORIGIN || "";
if (!/^https:\/\/[^/]+\/?$/.test(origin) || /@/.test(origin)) {
  throw new Error("Set IOETI_STAGING_ORIGIN to the trusted HTTPS staging origin");
}
if (!process.env.IOETI_PILOT_USER || !process.env.IOETI_PILOT_PASSWORD) {
  throw new Error("Set temporary fictional IOETI_PILOT_USER and IOETI_PILOT_PASSWORD");
}
if (process.env.IOETI_ENV !== "staging" || process.env.VITE_IOETI_DEMO === "true") {
  throw new Error("Live browser tests are allowed only for authenticated staging (never demo/production)");
}
export default defineConfig({
  testDir: "./live-tests",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origin,
    ignoreHTTPSErrors: false,
    screenshot: "off",
    video: "off",
    trace: "off",
    acceptDownloads: false,
  },
});
