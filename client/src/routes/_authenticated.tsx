import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"

import { adminStatusQuery } from "@/api/admin"
import { AppShell } from "@/components/layout/app-shell"
import type { DashboardTab } from "@/components/layout/sidebar"

const TAB_ROUTES: Record<
  DashboardTab,
  "/" | "/providers" | "/usage" | "/logs" | "/keys" | "/users" | "/settings"
> = {
  overview: "/",
  providers: "/providers",
  usage: "/usage",
  logs: "/logs",
  keys: "/keys",
  users: "/users",
  settings: "/settings",
}

function getTabFromPathname(pathname: string): DashboardTab {
  if (pathname.startsWith("/providers")) return "providers"
  if (pathname.startsWith("/usage")) return "usage"
  if (pathname.startsWith("/logs")) return "logs"
  if (pathname.startsWith("/keys")) return "keys"
  if (pathname.startsWith("/users")) return "users"
  if (pathname.startsWith("/settings")) return "settings"
  return "overview"
}

/**
 * Pathless layout that owns the session gate and dashboard shell.
 * `beforeLoad` runs before the route renders, ensuring protected screens
 * never flash unauthenticated content.
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
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentTab: DashboardTab = getTabFromPathname(location.pathname)

  const handleSelectTab = (tab: DashboardTab) => {
    navigate({
      to: TAB_ROUTES[tab],
    })
  }

  return (
    <AppShell currentTab={currentTab} onSelectTab={handleSelectTab}>
      <Outlet />
    </AppShell>
  )
}
