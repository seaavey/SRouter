import {
  BarChart3,
  Cpu,
  KeyRound,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Terminal,
  Users,
  X,
} from "lucide-react"
import { useEffect, useRef, useState, type ComponentType } from "react"

import { ScrollArea } from "@/components/arc/scroll-area/scroll-area"
import { Tooltip } from "@/components/arc/tooltip/tooltip"
import SRouterMark from "@/components/seavx/SRouterMark"

export type DashboardTab =
  "overview" | "providers" | "usage" | "logs" | "keys" | "users" | "settings"

/**
 * The section names, keyed by their tab. The rail labels each row with it and
 * the topbar names the current section with it, so one screen cannot end up
 * called two different things.
 */
export const TAB_LABELS = {
  overview: "Overview",
  providers: "Providers",
  usage: "Usage and quota",
  logs: "Request logs",
  keys: "API keys",
  users: "Users",
  settings: "Settings",
} satisfies Record<DashboardTab, string>

export type NavItem = {
  id: DashboardTab
  icon: ComponentType<{ size?: number; className?: string }>
}

type NavSection = {
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Gateway",
    items: [
      { id: "overview", icon: LayoutDashboard },
      { id: "providers", icon: Cpu },
      { id: "usage", icon: BarChart3 },
      { id: "logs", icon: Terminal },
      { id: "keys", icon: KeyRound },
      { id: "users", icon: Users },
    ],
  },
  {
    label: "System",
    items: [{ id: "settings", icon: Settings }],
  },
]

/** Long enough that a pointer crossing the rail does not open it by accident. */
const PEEK_DELAY_MS = 120

export type SidebarProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  currentTab: DashboardTab
  onSelectTab: (tab: DashboardTab) => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  currentTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  // The collapsed rail widens over the page instead of pushing it, so a peek
  // costs the content column nothing. The header control pins it open.
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const peeking = collapsed && peek
  const expanded = !collapsed || peeking

  function cancelPeek() {
    if (peekTimer.current !== null) {
      clearTimeout(peekTimer.current)
      peekTimer.current = null
    }
  }

  function closePeek() {
    cancelPeek()
    setPeek(false)
  }

  function schedulePeek() {
    if (!collapsed || peekTimer.current !== null) return
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null
      setPeek(true)
    }, PEEK_DELAY_MS)
  }

  // A pin or a collapse clears the peek from the control that caused it; this
  // only stops a pending open-timer from firing after unmount.
  useEffect(
    () => () => {
      if (peekTimer.current !== null) {
        clearTimeout(peekTimer.current)
      }
    },
    []
  )

  // The drawer covers the content and holds rows the pointer can reach, so it
  // carries the two ways out a pointer alone cannot give: Escape, and the
  // breakpoint where the permanent rail takes over.
  useEffect(() => {
    if (!mobileOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseMobile()
      }
    }
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        onCloseMobile()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleResize)
    }
  }, [mobileOpen, onCloseMobile])

  // `rail` is the icon-only state. The drawer is always expanded, even when the
  // rail was left collapsed, so the state cannot hide every label on a phone.
  const renderNavItem = (item: NavItem, rail: boolean) => {
    const isActive = currentTab === item.id
    const label = TAB_LABELS[item.id]
    const Icon = item.icon

    const row = (
      <button
        type="button"
        onClick={() => {
          onSelectTab(item.id)
          onCloseMobile()
        }}
        aria-current={isActive ? "page" : undefined}
        // A tooltip only describes an icon button; it does not name it. Without
        // this the rail's buttons have no accessible name at all.
        aria-label={rail ? label : undefined}
        className={`relative flex min-h-[var(--control-height-sm)] w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm tracking-tight transition-colors duration-150 ${
          isActive
            ? "bg-foreground/10 font-medium text-foreground"
            : "text-[var(--text-muted)] hover:bg-foreground/5 hover:text-foreground"
        } ${rail ? "justify-center px-0" : ""}`}
      >
        {/* The neutral accent is near-white, so a fill alone barely separates
            the open section from a hovered one; the bar is what carries the
            state when the palette has no hue to spend. */}
        {isActive && (
          <span
            className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-foreground"
            aria-hidden="true"
          />
        )}
        <Icon size={16} className="shrink-0" />
        {!rail && <span className="truncate">{label}</span>}
      </button>
    )

    if (rail) {
      return (
        <Tooltip key={item.id} content={label} side="right">
          {row}
        </Tooltip>
      )
    }

    return <div key={item.id}>{row}</div>
  }

  const renderContent = (rail: boolean) => (
    <div className="flex h-full min-h-0 flex-col bg-surface text-foreground">
      {/* Brand and rail controls */}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-border px-2 ${
          rail ? "justify-center" : "justify-between"
        }`}
      >
        <div
          className={`flex items-center gap-2.5 overflow-hidden ${rail ? "" : "ml-1"}`}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <SRouterMark />
          </div>
          {!rail && (
            <span className="truncate text-sm font-medium tracking-tight text-foreground">
              SRouter
            </span>
          )}
        </div>

        {!rail && (
          <>
            <Tooltip
              content={
                peeking ? "Pin sidebar open ([)" : "Collapse sidebar ([)"
              }
              side="bottom"
            >
              <button
                type="button"
                onClick={() => {
                  closePeek()
                  onToggleCollapse()
                }}
                aria-label={peeking ? "Pin sidebar open" : "Collapse sidebar"}
                className="hidden size-[var(--control-height-sm)] cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:inline-flex"
              >
                {peeking ? (
                  <PanelLeftOpen size={15} />
                ) : (
                  <PanelLeftClose size={15} />
                )}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation"
              className="inline-flex size-[var(--control-height-sm)] cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1" label="Dashboard navigation">
        <nav aria-label="Dashboard" className="flex flex-col gap-5 p-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="flex flex-col gap-1.5">
              {!rail && (
                <div className="px-2.5 py-1 text-xs text-muted-foreground">
                  {section.label}
                </div>
              )}
              <div className="flex flex-col gap-1">
                {section.items.map((item) => renderNavItem(item, rail))}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  )

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        inert={!mobileOpen}
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-surface transition-transform duration-200 ease-in-out md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {renderContent(false)}
      </aside>

      {/* The slot the rail occupies in the shell. The rail floats above the
          page, so its peek widens without moving the content column. */}
      <div
        aria-hidden="true"
        className={`hidden shrink-0 transition-[width] duration-200 ease-in-out motion-reduce:transition-none md:block ${
          collapsed ? "w-14" : "w-64"
        }`}
      />

      {/* Desktop Rail */}
      <aside
        onPointerEnter={(event) => {
          // A touch pointer never leaves, so a tap must not leave it open.
          if (event.pointerType !== "touch") {
            schedulePeek()
          }
        }}
        onPointerLeave={closePeek}
        onFocusCapture={() => {
          if (collapsed) {
            cancelPeek()
            setPeek(true)
          }
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            closePeek()
          }
        }}
        className={`absolute inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-border bg-surface transition-[width,box-shadow] duration-200 ease-in-out motion-reduce:transition-none md:flex ${
          expanded ? "w-64" : "w-14"
        } ${peeking ? "shadow-[var(--shadow-floating)]" : ""}`}
      >
        {renderContent(!expanded)}
      </aside>
    </>
  )
}
