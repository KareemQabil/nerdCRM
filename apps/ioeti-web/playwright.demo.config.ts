import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "demo.spec.ts",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev -- --port 5174",
    env: { VITE_IOETI_DEMO: "true" },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 40_000,
  },
});
