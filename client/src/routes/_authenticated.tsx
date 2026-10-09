import { createFileRoute, redirect } from "@tanstack/react-router"

import { adminStatusQuery } from "@/api/admin"

/**
 * Pathless layout that owns the session gate. `beforeLoad` runs before the
 * route renders, so a protected screen never flashes its content first.
 *
 * The status query is awaited rather than read from cache: on a cold load the
 * cache is empty, and assuming `authenticated: false` there would bounce a
 * signed-in operator to the login page on every refresh.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(adminStatusQuery)

    // A server with no admin account cannot authenticate anyone. Send the
    // operator to the setup form instead of a login form they cannot use.
    if (status.setup_required) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }

    if (!status.authenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
  },
})
