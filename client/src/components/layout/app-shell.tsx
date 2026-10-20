import { useEffect, useState, type ReactNode } from "react"

import { Sidebar, type DashboardTab } from "./sidebar"
import { Topbar } from "./topbar"

const STORAGE_KEY = "srouter_sidebar_collapsed"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = target.tagName.toLowerCase()
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest("[contenteditable='true']"))
  )
}

export interface AppShellProps {
  children: ReactNode
  currentTab: DashboardTab
  onSelectTab: (tab: DashboardTab) => void
}

export function AppShell({ children, currentTab, onSelectTab }: AppShellProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false
    }
    return window.localStorage.getItem(STORAGE_KEY) === "true"
  })

  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      }
      return next
    })
  }

  // Keyboard shortcut listener for UIARC rail toggle (`[`)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (
        event.key === "[" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        toggleCollapse()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    // `relative` anchors the desktop rail, which floats above the content so
    // its hover peek widens without moving the column.
    <div className="relative flex h-dvh w-full overflow-hidden bg-background font-sans text-foreground">
      {/* Collapsible App Rail Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        currentTab={currentTab}
        onSelectTab={onSelectTab}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Main Column */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          currentTab={currentTab}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenMobile={() => setMobileOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
