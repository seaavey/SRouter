// The overview is a protected screen, so the sign-in path is part of its
// contract: an anonymous visitor is bounced to /login, and the master password
// earns an HttpOnly session that unlocks the screen.
import { expect, test } from "@playwright/test"

import { ADMIN_PASSWORD } from "./support/data"

test.use({ storageState: { cookies: [], origins: [] } })

test("sends an anonymous visitor to the sign-in card", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/login/)
  await expect(
    page.getByRole("heading", { name: "Sign in to SRouter" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Gateway overview" })
  ).toHaveCount(0)
})

test("signs in with the master password and opens the overview", async ({
  page,
}) => {
  await page.goto("/login")

  await page.locator("#password").fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()

  await expect(
    page.getByRole("heading", { name: "Gateway overview" })
  ).toBeVisible()
  expect(new URL(page.url()).pathname).toBe("/")

  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "srouter_admin_session"
  )
  expect(session).toBeDefined()
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe("Lax")
})

test("rejects a wrong master password without opening the screen", async ({
  page,
}) => {
  await page.goto("/login")

  await page.locator("#password").fill("not-the-password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()

  await expect(
    page.getByRole("heading", { name: "Gateway overview" })
  ).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe("/login")
})
