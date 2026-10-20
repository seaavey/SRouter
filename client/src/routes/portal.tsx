import { createFileRoute, redirect } from "@tanstack/react-router"

import { APIError } from "@/api/client"
import { portalMeQuery } from "@/api/portal"
import PortalPage from "@/components/portal/PortalPage"

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: "SRouter - My account" }] }),
  beforeLoad: async ({ context }) => {
    try {
      // ensureQueryData hands back a cached entry without awaiting the refetch,
      // so only an awaiting read lets a dead session's 401 reach this gate.
      await context.queryClient.query(portalMeQuery)
    } catch (error) {
      // Only a missing session belongs on the login page; a server fault must
      // surface as the route error, not as a login form that cannot fix it.
      // No redirect param either: /portal would send a password login back
      // here, where the admin cookie 401s and bounces it to /login again.
      if (error instanceof APIError && error.status === 401) {
        throw redirect({ to: "/login" })
      }
      throw error
    }
  },
  component: PortalPage,
})
