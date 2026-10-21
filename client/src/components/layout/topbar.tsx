import { Menu, PanelLeft } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"

import { providerDetailQuery } from "@/api/providers"
import {
  Breadcrumb,
  type BreadcrumbItem,
} from "@/components/arc/breadcrumb/breadcrumb"
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch"
import { Tooltip } from "@/components/arc/tooltip/tooltip"
import { useTheme } from "@/components/theme-provider"
import useMediaQuery from "@/hooks/useMediaQuery"
import { TAB_LABELS, type DashboardTab } from "./sidebar"

// The inverse of Tailwind's `md`, matching the breakpoint the sidebar uses
// to swap its drawer for the permanent rail.
const BELOW_MD = "(max-width: 767.98px)"

export type TopbarProps = {
  currentTab: DashboardTab
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenMobile: () => void
}

export function Topbar({
  currentTab,
  collapsed,
  onToggleCollapse,
  onOpenMobile,
}: TopbarProps) {
  const navigate = useNavigate()

  // The detail route owns the `providerId` param, so read it from the router
  // instead of matching the path by hand. Off that route the param is absent.
  const routeParams = useParams({ strict: false })
  const providerID =
    typeof routeParams.providerId === "string"
      ? decodeURIComponent(routeParams.providerId)
      : ""

  const { data: provider } = useQuery({
    ...providerDetailQuery(providerID),
    enabled: Boolean(providerID),
  })

  const { resolvedTheme, setTheme } = useTheme()
  // One toggle per viewport: the drawer opener below `md`, the rail expander
  // above it. Two buttons hiding each other through `hidden`/`md:` display
  // utilities render side by side, because both display classes apply to the
  // same element and the cascade does not honour their written order.
  const isMobile = useMediaQuery(BELOW_MD)

  const controlClass =
    "inline-flex size-[var(--control-height-sm)] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: "SRouter", onClick: () => navigate({ to: "/" }) },
  ]

  if (providerID) {
    breadcrumbItems.push({
      label: "Providers",
      onClick: () => navigate({ to: "/providers" }),
    })
    breadcrumbItems.push({
      label: provider?.name || providerID,
    })
  } else {
    breadcrumbItems.push({
      label: TAB_LABELS[currentTab],
    })
  }

  return (
    // The horizontal padding mirrors `main` in app-shell, so the crumb sits on
    // the same vertical line as the page heading below it.
    <header className="sticky top-0 z-20 flex h-14 w-full shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      {isMobile ? (
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label="Open navigation"
          className={controlClass}
        >
          <Menu size={18} />
        </button>
      ) : (
        collapsed && (
          <Tooltip content="Expand sidebar ([)" side="bottom">
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className={controlClass}
            >
              <PanelLeft size={17} />
            </button>
          </Tooltip>
        )
      )}

      {/* Crumbs name the section on the left, the theme switch sits opposite
          on the right, so the two ends of the bar balance. The crumb row
          takes the room the controls do not, and a long path truncates at the
          last crumb instead of wrapping out of the fixed-height bar. */}
      <Breadcrumb items={breadcrumbItems} className="min-w-0 flex-1" />

      <div className="ml-auto flex shrink-0 items-center">
        <ThemeSwitch
          theme={resolvedTheme}
          variant="split"
          iconOnly
          onThemeChange={(next) => setTheme(next)}
        />
      </div>
    </header>
  )
}
