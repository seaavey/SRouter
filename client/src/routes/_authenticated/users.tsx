import { createFileRoute } from "@tanstack/react-router"

import UsersView from "@/components/users/UsersView"

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "SRouter - Users" }] }),
  component: UsersPage,
})

function UsersPage() {
  return <UsersView />
}
