import { defineConfig, devices } from "@playwright/test";

// Voted 2026 defaults: role-first locators in specs, trace on first retry,
// HTML report artifact, workers=1 (specs share one demo DB deterministically).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["blob"], ["html", { open: "never" }]] : [["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8081",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  timeout: 45_000,
  expect: { timeout: 10_000 },
});
