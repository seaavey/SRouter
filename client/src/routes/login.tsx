import { createFileRoute, redirect, useSearch } from "@tanstack/react-router"

import { adminStatusQuery } from "@/api/admin"
import LoginPage from "@/components/auth/LoginPage"

type LoginSearch = { redirect?: string }

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "SRouter - Login" }] }),
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context }) => {
    // A failed status read falls through to the page's offline card; only a
    // reachable server holding an admin session leaves the sign-in screen.
    const status = await context.queryClient
      .query(adminStatusQuery)
      .catch(() => null)

    if (status?.authenticated) {
      throw redirect({ to: "/" })
    }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const { redirect } = useSearch({ from: "/login" })
  return <LoginPage redirect={redirect} />
}
