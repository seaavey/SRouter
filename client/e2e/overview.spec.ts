// Behaviour of the gateway overview: the KPI row, the token card, the range and
// metric switches, and the sortable model table. Every figure is checked
// against `GET /v1/logs/analytics`, the endpoint the screen reads, so a change
// to either side of that contract fails here.
import { expect, test } from "@playwright/test"

import type { AnalyticsReport } from "../../src/generated/typed"
import { expectedTotals, modelTotals } from "./support/data"
import {
  bucketTotals,
  cacheHitRate,
  chartRegion,
  fmt,
  kpiRegion,
  modelTable,
  readableText,
} from "./support/overview"

const RANGE_HEADINGS = {
  "1h": "Token throughput per minute, past hour?",
  "24h": "Token throughput per hour, past day?",
  "7d": "Token throughput per 6 hours, past week?",
  "30d": "Token throughput per day, past month?",
} as const

const RANGE_OPTIONS = ["1h", "24h", "7d", "30d"] as const

test.describe("gateway overview", () => {
  let report: AnalyticsReport
  let analyticsWindows: string[]
  let consoleErrors: string[]
  let pageErrors: string[]

  test.beforeEach(async ({ page, request }) => {
    analyticsWindows = []
    consoleErrors = []
    pageErrors = []

    page.on("request", (outgoing) => {
      const url = new URL(outgoing.url())
      if (url.pathname === "/v1/logs/analytics") {
        analyticsWindows.push(url.searchParams.get("window") ?? "")
      }
    })
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text())
      }
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))

    const response = await request.get("/v1/logs/analytics?window=24h")
    expect(response.ok()).toBe(true)
    report = (await response.json()) as AnalyticsReport

    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Gateway overview" })
    ).toBeVisible()
  })

  test("renders the headline figures from the analytics window", async ({
    page,
  }) => {
    const seed = expectedTotals()
    const totals = bucketTotals(report)

    // Seed integrity first: if these drift the stack is wrong, not the screen.
    expect(report.total_requests).toBe(seed.requests)
    expect(totals.total).toBe(seed.total)

    const kpi = kpiRegion(page)
    await expect(kpi).toContainText("past 24h")

    const stats = (await kpi.locator("div.grid > div").allInnerTexts()).map(
      (text) => text.replace(/\s+/g, " ").trim()
    )

    expect(stats).toHaveLength(4)
    expect(stats[0]).toBe(`Requests ${fmt(report.total_requests)} past 24h`)
    expect(stats[1]).toMatch(/^P95 Latency \d+ ms upstream time$/)
    expect(stats[2]).toBe(
      `Error Rate ${((report.error_rate ?? 0) * 100).toFixed(1)}% failures`
    )
    expect(stats[3]).toBe(
      `Est. Spend $${(report.est_cost ?? 0).toFixed(2)} past 24h`
    )
    // Unknown models carry no price, so the seeded priced model has to have
    // moved the spend off zero for this card to mean anything.
    expect(stats[3]).not.toBe("Est. Spend $0.00 past 24h")
  })

  test("summarises token throughput and the prompt cache rate", async ({
    page,
  }) => {
    const totals = bucketTotals(report)
    const kpi = kpiRegion(page)
    await expect(kpi).toContainText("Token Throughput")

    const tokenCard = kpi.locator(":scope > div").nth(1)
    const text = await readableText(tokenCard)

    expect(text).toContain(`${fmt(totals.total)} total`)
    expect(text).toContain(`In: ${fmt(totals.prompt)}`)
    expect(text).toContain(`Out: ${fmt(totals.completion)}`)
    expect(text).toContain(
      `Cache Hit: ${cacheHitRate(totals.prompt, totals.cached)}%`
    )
  })

  test("re-reads analytics for every range the control offers", async ({
    page,
  }) => {
    const chart = chartRegion(page)

    for (const range of RANGE_OPTIONS) {
      await page.getByRole("button", { name: range, exact: true }).click()
      await expect(chart.getByRole("heading")).toHaveText(
        RANGE_HEADINGS[range],
        { timeout: 10_000 }
      )
      await expect(kpiRegion(page)).toContainText(`past ${range}`)
    }

    await expect
      .poll(() => analyticsWindows, { timeout: 10_000 })
      .toEqual(expect.arrayContaining([...RANGE_OPTIONS]))
    // The window is what the request carries, not only what the heading says.
    expect(analyticsWindows).toContain("7d")
  })

  test("switches the plot between tokens and requests", async ({ page }) => {
    const chart = chartRegion(page)
    const metric = chart.getByRole("group", { name: "Chart metric" })

    await expect(
      chart.getByRole("button", { name: "Total tokens" })
    ).toBeVisible()

    await metric.getByRole("button", { name: "Requests" }).click()
    await expect(chart.getByRole("heading")).toHaveText(
      "How many requests per hour, past day?"
    )
    // The token legend belongs to the token series only.
    await expect(
      chart.getByRole("button", { name: "Total tokens" })
    ).toHaveCount(0)
    await expect(chart.getByRole("button", { name: "Cached" })).toHaveCount(0)

    await metric.getByRole("button", { name: "Tokens" }).click()
    await expect(chart.getByRole("heading")).toHaveText(
      "Token throughput per hour, past day?"
    )
    await expect(
      chart.getByRole("button", { name: "Total tokens" })
    ).toBeVisible()
  })

  test("draws the plot and names its latest values", async ({ page }) => {
    const chart = chartRegion(page)

    await expect(chart.locator("svg").first()).toBeVisible()
    await expect(chart).toContainText(
      /Gateway telemetry, .* to .*\. Total tokens, latest [\d,]+\. Input, latest [\d,]+\. Output, latest [\d,]+\. Cached, latest [\d,]+/
    )
    // The plot is the widest svg in the region; the legend icons are 15px.
    // A drawn series is a path with real extent, not just an empty frame.
    const marks = await chart.evaluate((element) => {
      const svgs = [...element.querySelectorAll("svg")]
      const plot = svgs.sort(
        (a, b) =>
          b.getBoundingClientRect().width - a.getBoundingClientRect().width
      )[0]
      if (!plot) {
        return 0
      }
      return [...plot.querySelectorAll("path")].filter((path) => {
        const box = path.getBoundingClientRect()
        return (
          box.width > 50 &&
          box.height > 1 &&
          getComputedStyle(path).opacity !== "0"
        )
      }).length
    })
    expect(marks).toBeGreaterThanOrEqual(2)
  })

  test("sorts the model table from its column headers", async ({ page }) => {
    const table = modelTable(page)
    const rows = table.getByRole("row")
    const priced = modelTotals("gpt-4o-mini")
    const small = modelTotals("gpt-e2e")
    const requestsHeader = table
      .getByRole("columnheader")
      .filter({ hasText: "Requests" })
    const tokensHeader = table
      .getByRole("columnheader")
      .filter({ hasText: "Tokens" })

    // Default sort: requests, descending, so the busiest model leads.
    await expect(requestsHeader).toHaveAttribute("aria-sort", "descending")
    await expect(rows.nth(1)).toContainText("mock/gpt-4o-mini")
    await expect(rows.nth(1)).toContainText(fmt(priced.total))
    await expect(rows.nth(1)).toContainText(`${priced.cacheRate}%`)
    await expect(rows.nth(2)).toContainText("mock/gpt-e2e")
    await expect(rows.nth(2)).toContainText(fmt(small.total))

    await tokensHeader.getByRole("button").click()
    await expect(tokensHeader).toHaveAttribute("aria-sort", "ascending")
    await expect(rows.nth(1)).toContainText("mock/gpt-e2e")

    await tokensHeader.getByRole("button").click()
    await expect(tokensHeader).toHaveAttribute("aria-sort", "descending")
    await expect(rows.nth(1)).toContainText("mock/gpt-4o-mini")
    await expect(rows.nth(2)).toContainText("mock/gpt-e2e")
  })

  test("counts the active models in the table badge", async ({ page }) => {
    const table = modelTable(page)

    await expect(
      table.getByRole("row", { name: /mock\/gpt-4o-mini/ })
    ).toContainText("mock/gpt-4o-mini")
    await expect(page.getByText("2 models active")).toBeVisible()
  })

  test("reports the live event stream as connected", async ({ page }) => {
    // The overview subscribes to `/v1/logs/events` on mount; the badge is the
    // operator's only signal that the stream is up.
    await expect(page.getByText("Live stream active")).toBeVisible({
      timeout: 15_000,
    })
  })

  test("loads without console errors or uncaught exceptions", async ({
    page,
  }) => {
    await expect(kpiRegion(page)).toBeVisible()
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
