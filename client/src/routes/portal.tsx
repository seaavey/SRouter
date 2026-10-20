import { createFileRoute, redirect } from "@tanstack/react-router"

import { APIError } from "@/api/client"
import { portalMeQuery } from "@/api/portal"
import PortalPage from "@/components/portal/PortalPage"

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: "SRouter - My account" }] }),
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(portalMeQuery)
    } catch (error) {
      // Only a missing session belongs on the login page; a server fault must
      // surface as the route error, not as a login form that cannot fix it.
      if (error instanceof APIError && error.status === 401) {
        throw redirect({ to: "/login", search: { redirect: location.href } })
      }
      throw error
    }
  },
  component: PortalPage,
})
