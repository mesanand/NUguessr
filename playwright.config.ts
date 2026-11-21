import { defineConfig, devices } from "@playwright/test"

// E2E against a running app. By default starts `next dev` on :3100 using the
// env of the current shell (point NEXT_PUBLIC_SUPABASE_* at the local stack
// for local runs). Set E2E_BASE_URL to test an existing deployment instead,
// e.g. E2E_BASE_URL=https://nuguessr.vercel.app npx playwright test
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
// Uses the installed Microsoft Edge/Chrome channel so no browser download is needed.
const channel = process.env.E2E_CHANNEL ?? "msedge"

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1366, height: 860 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev -p 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
