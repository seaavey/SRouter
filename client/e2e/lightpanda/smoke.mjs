// Functional smoke of the overview on Lightpanda over CDP.
//
// Lightpanda cannot verify the four UI modes: it has no media-query layout, so
// every viewport reports the same 1920px document, and it ignores Playwright
// network interception, so the error and empty states are out of reach. What it
// does well is fast, real-JS navigation — this script proves the SPA boots,
// authenticates, renders telemetry, and reacts to the range control.
//
//   bun run e2e:stack            # in one shell
//   lightpanda serve --host 127.0.0.1 --port 9222
//   bun run e2e:lightpanda
import assert from "node:assert/strict"

import { chromium } from "playwright-core"

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100"
const cdpURL = process.env.E2E_CDP_URL ?? "ws://127.0.0.1:9222"
const password = process.env.E2E_ADMIN_PASSWORD ?? "srouter-e2e-password"

let checks = 0

async function check(name, assertion) {
  await assertion
  checks += 1
  console.log(`ok ${checks} - ${name}`)
}

async function mainText(page) {
  return page.evaluate(() => document.querySelector("main")?.innerText ?? "")
}

const browser = await chromium.connectOverCDP(cdpURL)
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
})
const page = await context.newPage()

try {
  await page.goto(`${baseURL}/login`)

  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()

  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "Gateway overview",
    undefined,
    { timeout: 20_000 }
  )
  await check("signs in and lands on the overview", Promise.resolve())

  const kpi = await mainText(page)
  await check("renders the Requests figure", () =>
    assert.match(kpi, /Requests\s*\d/)
  )
  await check("renders the token card", () =>
    assert.match(kpi, /Cache Hit:\s*\d+\.\d%/)
  )
  await check("names the default window", () =>
    assert.match(kpi, /Token throughput per hour, past day\?/)
  )

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "7d"
    )
    if (!button) {
      throw new Error("the 7d range button is missing")
    }
    button.click()
  })

  await page.waitForFunction(
    () =>
      document.body.innerText.includes(
        "Token throughput per 6 hours, past week?"
      ),
    undefined,
    { timeout: 15_000 }
  )
  await check("switches the plot to the 7d window", Promise.resolve())

  const rows = await page.evaluate(
    () => document.querySelectorAll("table[role='table'] tbody tr").length
  )
  await check("lists the routed models", () => assert.equal(rows, 2))

  console.log(`\n${checks} checks passed on ${cdpURL}`)
} finally {
  await context.close()
  await browser.close()
}
