import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import {
  Activity01Icon,
  ComputerTerminal01Icon,
  DashboardSquare01Icon,
  Key01Icon,
  Logout01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { adminStatusQuery } from "@/shared/api/queries"
import { request } from "@/shared/api/client"
import { Button } from "@/shared/components/ui/button"
import { Separator } from "@/shared/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/shared/components/ui/sidebar"

/**
 * The operator's navigation. Every entry points at a route that exists, and the
 * order follows the decision order from `client/DESIGN.md`: what is happening
 * now, then what is configured, then the record.
 */
const NAVIGATION = [
  { to: "/", label: "Dashboard", icon: DashboardSquare01Icon },
  { to: "/providers", label: "Providers", icon: ServerStack01Icon },
  { to: "/logs", label: "Request logs", icon: ComputerTerminal01Icon },
  { to: "/keys", label: "API keys", icon: Key01Icon },
] as const

function AppSidebar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const logout = useMutation({
    mutationFn: () => request<void>("/v1/admin/logout", { method: "POST" }),
    onSuccess: async () => {
      // Drop every cached response, not just the status: the next operator to
      // sign in on this browser must not see the previous one's data.
      queryClient.clear()
      await navigate({ to: "/login", search: {}, replace: true })
    },
  })

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <HugeiconsIcon icon={Activity01Icon} className="text-brand" />
          <span className="text-xs font-medium">SRouter</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gateway</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAVIGATION.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} activeOptions={{ exact: item.to === "/" }} />}
                  >
                    <HugeiconsIcon icon={item.icon} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Separator />
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <HugeiconsIcon icon={Logout01Icon} data-icon="inline-start" />
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}

export const Route = createFileRoute("/_authenticated")({
  /**
   * The session gate. `beforeLoad` runs before the route renders, so a protected
   * screen never flashes its content first.
   *
   * The status query is awaited rather than read from cache: on a cold load the
   * cache is empty, and assuming `authenticated: false` there would bounce a
   * signed-in operator to the login page on every refresh.
   */
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(adminStatusQuery)

    // A server with no admin account cannot authenticate anyone. Send the
    // operator to the setup form instead of a login form they cannot use.
    if (status.setup_required || !status.authenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
  },
  component: () => (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
        </header>
        <div className="min-w-0 flex-1 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  ),
})
