import { motion } from "motion/react"
import type { ReactNode } from "react"

import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch"
import SRouterMark from "@/components/seavx/SRouterMark"
import { useTheme } from "@/components/theme-provider"

import AuthBackground from "./AuthBackground"
import type { AuthAudience, AuthConnection } from "./types"

type AuthShellProps = {
  /** Who the footer says is signing in. */
  audience: AuthAudience
  /** The card body: the form, the spinner, or the retry notice. */
  children: ReactNode
  /** What the gateway is doing, as the footer reports it. */
  connection: AuthConnection
}

const CONNECTION: Record<AuthConnection, { dot: string; label: string }> = {
  connecting: { dot: "bg-warning", label: "Connecting" },
  offline: { dot: "bg-danger", label: "Server offline" },
  online: { dot: "bg-success", label: "Gateway online" },
}

const AUDIENCE: Record<AuthAudience, string> = {
  operator: "Operator authentication",
  customer: "Customer authentication",
}

/**
 * The page around a sign-in card: the orbital rings, the brand, the card
 * frame, and the footer. The card fades in once the gateway answers, so the
 * reader sees the form arrive instead of a blank box.
 */
export default function AuthShell({
  audience,
  children,
  connection,
}: AuthShellProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const { dot, label } = CONNECTION[connection]

  const frame =
    "relative z-1 w-full max-w-[24.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.05),0_10px_24px_-4px_rgba(0,0,0,0.06)] dark:border-white/12 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_16px_36px_-6px_rgba(0,0,0,0.65)]"

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background text-foreground">
      <AuthBackground />
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-6">
        <div className="inline-flex items-center gap-3 text-foreground no-underline">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <SRouterMark />
          </div>
          <span className="text-sm font-medium tracking-tight text-foreground">
            SRouter
          </span>
        </div>
        <ThemeSwitch
          theme={resolvedTheme}
          variant="split"
          iconOnly
          onThemeChange={(next) => setTheme(next)}
        />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-6">
        <div
          className="pointer-events-none absolute z-0 size-[32rem] rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.01)_40%,transparent_70%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_40%,transparent_70%)]"
          aria-hidden="true"
        />
        {connection === "online" ? (
          <motion.div
            className={frame}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        ) : (
          <div className={frame}>{children}</div>
        )}
      </main>

      <footer className="relative z-10 flex items-center justify-between px-5 py-4 text-xs text-muted-foreground sm:px-8 sm:py-5">
        <div className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${dot}`} />
          <span>{label}</span>
        </div>
        <span>{AUDIENCE[audience]}</span>
      </footer>
    </div>
  )
}
