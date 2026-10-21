// Locators and formatters for the overview screen, kept in one place so the
// specs read as behaviour instead of selector archaeology.
import type { Locator, Page } from "@playwright/test"

import type { AnalyticsReport } from "../../src/generated/typed"

/** The page formats every figure with the en-US grouping. */
export function fmt(value: number) {
  return value.toLocaleString("en-US")
}

/** The KPI card pair; its accessible name carries the selected window. */
export function kpiRegion(page: Page) {
  return page.getByRole("region", { name: /Key gateway telemetry/ })
}

/** The throughput plot. */
export function chartRegion(page: Page) {
  return page.getByRole("region", { name: "Gateway throughput over time" })
}

/** The per-model breakdown under the plot. */
export function modelTable(page: Page) {
  return page.getByRole("table", { name: /Active model performance/ })
}

/** Column sums for the buckets the plot and the token card are drawn from. */
export function bucketTotals(report: AnalyticsReport) {
  const totals = { requests: 0, prompt: 0, completion: 0, cached: 0, total: 0 }

  for (const bucket of report.buckets) {
    totals.requests += bucket.total_requests
    totals.prompt += bucket.prompt_tokens
    totals.completion += bucket.completion_tokens
    totals.cached += bucket.cached_tokens
    totals.total += bucket.total_tokens
  }

  return totals
}

/**
 * Reads text the way a person sees it. `textContent` glues adjacent block
 * elements together ("Requests6past 24h") because React emits no whitespace
 * between them, so the assertions use `innerText` with the line breaks folded.
 */
export async function readableText(locator: Locator) {
  return (await locator.innerText()).replace(/\s+/g, " ").trim()
}

/** The cache-hit percentage exactly as the page rounds it. */
export function cacheHitRate(promptTokens: number, cachedTokens: number) {
  const rate = promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0
  return rate.toFixed(1)
}
