// The same screen in the four UI modes the product supports: phone, tablet,
// laptop, desktop. These assertions are about layout, so they only run in a
// browser with a real layout engine (Chromium) — see e2e/lightpanda/README.md
// for why Lightpanda cannot stand in here.
import { expect, test, type Page } from "@playwright/test"

import { chartRegion, kpiRegion, modelTable } from "./support/overview"

type Mode = "hp" | "tablet" | "laptop" | "desktop"

interface ModeExpectation {
  /** Drawer opener below `md`, permanent rail above it. */
  navigation: "drawer" | "rail"
  /** `main` padding from `p-4 sm:p-6 lg:p-8`. */
  mainPadding: number
  /** KPI figures sit in two columns on a phone, four from `sm` up. */
  kpiColumns: number
  /** The model table is wider than the content column on narrow screens. */
  tableScrolls: boolean
  /** `SectionHeader` stacks below `sm` and becomes one row from `sm` up. */
  headerStacks: boolean
}

const MODES: Record<Mode, ModeExpectation> = {
  hp: {
    navigation: "drawer",
    mainPadding: 16,
    kpiColumns: 2,
    tableScrolls: true,
    headerStacks: true,
  },
  tablet: {
    navigation: "rail",
    mainPadding: 24,
    kpiColumns: 4,
    tableScrolls: true,
    headerStacks: false,
  },
  laptop: {
    navigation: "rail",
    mainPadding: 32,
    kpiColumns: 4,
    tableScrolls: false,
    headerStacks: false,
  },
  desktop: {
    navigation: "rail",
    mainPadding: 32,
    kpiColumns: 4,
    tableScrolls: false,
    headerStacks: false,
  },
}

function mode(testInfo: { project: { name: string } }): Mode {
  const name = testInfo.project.name
  if (
    name === "hp" ||
    name === "tablet" ||
    name === "laptop" ||
    name === "desktop"
  ) {
    return name
  }

  throw new Error(`unknown UI mode "${name}"`)
}

async function openOverview(page: Page) {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Gateway overview" })
  ).toBeVisible()
  await expect(kpiRegion(page)).toBeVisible()
  await expect(modelTable(page).getByRole("row")).toHaveCount(3)
}

test.describe("overview layout", () => {
  test("keeps the page inside the viewport", async ({ page }) => {
    await openOverview(page)

    const metrics = await page.evaluate(() => ({
      documentScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      widestSection: Math.max(
        ...Array.from(document.querySelectorAll("main section")).map(
          (section) => section.getBoundingClientRect().right
        )
      ),
    }))

    expect(metrics.documentScroll).toBeLessThanOrEqual(metrics.viewport)
    expect(metrics.widestSection).toBeLessThanOrEqual(metrics.viewport + 1)
  })

  test("offers the navigation its breakpoint calls for", async ({
    page,
  }, testInfo) => {
    const expectation = MODES[mode(testInfo)]
    await openOverview(page)

    const drawer = page.getByRole("button", { name: "Open navigation" })
    // Both the rail and the drawer hold a `Dashboard` nav in the DOM; the one
    // that is actually on screen is told apart by its position, because the
    // closed drawer slides out instead of unmounting.
    const navX = () =>
      page
        .getByRole("navigation", { name: "Dashboard" })
        .boundingBox()
        .then((box) => box?.x ?? Number.NaN)

    if (expectation.navigation === "drawer") {
      await expect(drawer).toBeVisible()
      expect(await navX()).toBeLessThan(0)

      await drawer.click()
      await expect.poll(navX).toBeGreaterThanOrEqual(0)

      await page.getByRole("button", { name: "Close navigation" }).click()
      await expect.poll(navX).toBeLessThan(0)
      return
    }

    await expect(drawer).toHaveCount(0)
    expect(await navX()).toBeGreaterThanOrEqual(0)
  })

  test("stacks the section header only below sm", async ({
    page,
  }, testInfo) => {
    const expectation = MODES[mode(testInfo)]
    await openOverview(page)

    const title = await page
      .getByRole("heading", { name: "Gateway overview" })
      .boundingBox()
    const range = await page
      .getByRole("group", { name: "Time range" })
      .boundingBox()

    expect(title).not.toBeNull()
    expect(range).not.toBeNull()
    if (!title || !range) {
      return
    }

    if (expectation.headerStacks) {
      // The control drops under the title instead of sharing its row.
      expect(range.y).toBeGreaterThan(title.y + title.height - 1)
      return
    }

    expect(range.y).toBeLessThan(title.y + title.height)
    expect(range.x).toBeGreaterThan(title.x + title.width)
  })

  test("lays the KPI figures out for the available width", async ({
    page,
  }, testInfo) => {
    const expectation = MODES[mode(testInfo)]
    await openOverview(page)

    const grid = kpiRegion(page).locator("div.grid").first()
    await expect(grid).toBeVisible()

    const columns = await grid.evaluate((element) => {
      const template = getComputedStyle(element).gridTemplateColumns
      return template.split(" ").filter(Boolean).length
    })

    expect(columns).toBe(expectation.kpiColumns)
  })

  test("pads the content column to the breakpoint", async ({
    page,
  }, testInfo) => {
    const expectation = MODES[mode(testInfo)]
    await openOverview(page)

    const padding = await page
      .locator("main")
      .evaluate((element) => getComputedStyle(element).paddingLeft)

    expect(padding).toBe(`${expectation.mainPadding}px`)
  })

  test("scrolls the model table inside its own box", async ({
    page,
  }, testInfo) => {
    const expectation = MODES[mode(testInfo)]
    await openOverview(page)

    const metrics = await modelTable(page).evaluate((element) => {
      const scroller = element.parentElement
      if (!scroller) {
        return null
      }
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      }
    })

    expect(metrics).not.toBeNull()
    if (!metrics) {
      return
    }

    if (expectation.tableScrolls) {
      expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
      return
    }

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  })

  test("keeps every chart control clickable in view", async ({ page }) => {
    await openOverview(page)

    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    if (!viewport) {
      return
    }

    const rangeControls = await page
      .getByRole("group", { name: "Time range" })
      .getByRole("button")
      .all()
    const metricControls = await page
      .getByRole("group", { name: "Chart metric" })
      .getByRole("button")
      .all()
    const controls = [...rangeControls, ...metricControls]
    expect(controls.length).toBe(6)

    for (const control of controls) {
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      if (!box) {
        continue
      }
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    }

    // A control that fits but cannot be pressed still fails the operator.
    await page
      .getByRole("group", { name: "Chart metric" })
      .getByRole("button", { name: "Requests" })
      .click()
    await expect(chartRegion(page).getByRole("heading")).toHaveText(
      "How many requests per hour, past day?"
    )
  })

  test("records a screenshot of the mode", async ({ page }, testInfo) => {
    const current = mode(testInfo)
    await openOverview(page)

    // The shell scrolls inside `main` and is viewport-tall, so a full-page
    // capture stops at the fold. Two shots: the fold, then the model table.
    const top = testInfo.outputPath(`overview-${current}.png`)
    await page.screenshot({ path: top, animations: "disabled" })
    await testInfo.attach(`overview-${current}`, {
      path: top,
      contentType: "image/png",
    })

    await modelTable(page).scrollIntoViewIfNeeded()
    const table = testInfo.outputPath(`overview-${current}-table.png`)
    await page.screenshot({ path: table, animations: "disabled" })
    await testInfo.attach(`overview-${current}-table`, {
      path: table,
      contentType: "image/png",
    })
  })
})
