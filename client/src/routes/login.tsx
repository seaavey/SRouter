import { createFileRoute, useSearch } from "@tanstack/react-router"

import LoginPage from "@/components/auth/LoginPage"

type LoginSearch = { redirect?: string }

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "SRouter - Login" }] }),
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginRoute,
})

function LoginRoute() {
  const { redirect } = useSearch({ from: "/login" })
  return <LoginPage redirect={redirect} />
}
