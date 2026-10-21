// The two states the overview can land in besides success: the analytics read
// failed, and the window is empty. Neither can be produced from the seeded
// fixtures, so the response is intercepted at the network layer while every
// other request stays real.
import { expect, test } from "@playwright/test"

import type { AnalyticsReport } from "../../src/generated/typed"
import { chartRegion, kpiRegion, modelTable } from "./support/overview"

const EMPTY_REPORT: AnalyticsReport = {
  object: "analytics",
  window: "24h",
  bucket_size_ms: 3_600_000,
  generated_at: 0,
  requests_per_second: 0,
  total_requests: 0,
  error_rate: 0,
  p95_latency_ms: 0,
  est_cost: 0,
  buckets: [],
  top_models: [],
  top_agents: [],
  providers: [],
}

const ANALYTICS_PATTERN = "**/v1/logs/analytics*"

test("surfaces a failed analytics read and retries it", async ({ page }) => {
  let failures = 1

  await page.route(ANALYTICS_PATTERN, async (route) => {
    if (failures > 0) {
      failures -= 1
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            message: "analytics store is unavailable",
            type: "server_error",
            code: "service_unavailable",
          },
        }),
      })
      return
    }

    await route.continue()
  })

  await page.goto("/")

  const failure = page.getByRole("region", {
    name: "Gateway telemetry unavailable",
  })
  await expect(failure).toBeVisible()
  await expect(failure).toContainText("Could not load gateway telemetry")
  await expect(failure).toContainText("analytics store is unavailable")

  await failure.getByRole("button", { name: "Retry" }).click()
  await expect(kpiRegion(page)).toBeVisible()
  await expect(page.getByText("Could not load gateway telemetry")).toHaveCount(
    0
  )
  await expect(modelTable(page).getByRole("row")).toHaveCount(3)
})

test("explains an empty window instead of drawing zeros", async ({ page }) => {
  await page.route(ANALYTICS_PATTERN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_REPORT),
    })
  })

  await page.goto("/")

  const kpi = kpiRegion(page)
  await expect(kpi).toContainText("past 24h")

  const stats = (await kpi.locator("div.grid > div").allInnerTexts()).map(
    (text) => text.replace(/\s+/g, " ").trim()
  )
  expect(stats[0]).toBe("Requests 0 past 24h")
  expect(stats[3]).toBe("Est. Spend $0.00 past 24h")

  await expect(page.getByText("0 models active")).toBeVisible()
  await expect(
    page.getByText("No requests recorded in this window")
  ).toBeVisible()
  // The plot repeats its empty label in the screen-reader summary, so match the
  // visible node exactly rather than every element containing that sentence.
  await expect(
    chartRegion(page).getByText("No traffic recorded in this window", {
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByText("Per-model performance populates automatically", {
      exact: false,
    })
  ).toBeVisible()
})
