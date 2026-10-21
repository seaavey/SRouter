import { defineConfig } from "@playwright/test"

const port = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${port}`

/**
 * The suite runs against a throwaway gateway: `e2e/support/stack.ts` builds the
 * server and the SPA, boots them on a temporary SQLite file with a mock
 * upstream, and seeds real traffic before the first test starts.
 *
 * One worker on purpose: every spec asserts the same seeded traffic totals, so
 * parallel projects would race on a shared database.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.tmp/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    storageState: "./e2e/.tmp/storage-state.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "bun e2e/support/stack.ts",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "hp",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "laptop",
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: "desktop",
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
})
