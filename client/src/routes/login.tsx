import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useRef, useState } from "react"

import { APIError } from "@/api/client"
import { loginPortal } from "@/api/portal"
import { useAdminAuth } from "@/components/admin-auth-provider"
import { ActionButton } from "@/components/arc/action-button/action-button"
import { PasswordField } from "@/components/arc/password-field/password-field"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import SRouterMark from "@/components/seavx/SRouterMark"
import { useTheme } from "@/components/theme-provider"

type LoginSearch = { redirect?: string }

type LoginMode = "password" | "token"

const LOGIN_MODE_OPTIONS: { value: LoginMode; label: string }[] = [
  { value: "password", label: "Password" },
  { value: "token", label: "Access token" },
]

export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Login,
})

/** Turns a failed login into the one sentence the operator needs. */
function describe(error: Error | null) {
  if (!(error instanceof APIError)) {
    return "Could not reach the server."
  }

  // The server throttles repeated failures per client address.
  if (error.status === 429) {
    return "Too many attempts. Wait a moment and try again."
  }

  return error.message
}

function BackgroundRings() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 [mask-image:radial-gradient(ellipse_75%_75%_at_50%_50%,#000_30%,transparent_100%)]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          {/* Luminous bloom and blur filters */}
          <filter
            id="ring-glow-core"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="ring-glow-soft"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="5" />
          </filter>

          {/* Gradients along the curve for orbiting beams */}
          <linearGradient
            id="orbit-glow-420"
            x1="500"
            y1="80"
            x2="894.67"
            y2="356.35"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="40%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="75%" stopColor="currentColor" stopOpacity="0.65" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>

          <linearGradient
            id="orbit-glow-280"
            x1="500"
            y1="780"
            x2="270.64"
            y2="660.6"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="80%" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient
            id="orbit-glow-560"
            x1="-26.23"
            y1="308.47"
            x2="308.47"
            y2="-26.23"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="60%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {/* Static Base Geometry */}
        <circle
          cx="500"
          cy="500"
          r="280"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <circle
          cx="500"
          cy="500"
          r="420"
          className="fill-none stroke-border stroke-[1] opacity-65"
        />
        <circle
          cx="500"
          cy="500"
          r="560"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <line
          x1="80"
          y1="500"
          x2="920"
          y2="500"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <line
          x1="500"
          y1="80"
          x2="500"
          y2="920"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />

        {/* Outer Ring Orbit (Slow ambient celestial pulse) */}
        <g className="ring-orbit-outer text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M -26.23 308.47 A 560 560 0 0 1 308.47 -26.23"
            fill="none"
            stroke="url(#orbit-glow-560)"
            strokeWidth="5"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-40 dark:opacity-60"
          />
          <path
            d="M -26.23 308.47 A 560 560 0 0 1 308.47 -26.23"
            fill="none"
            stroke="url(#orbit-glow-560)"
            strokeWidth="1.25"
            strokeLinecap="round"
            className="opacity-60 dark:opacity-85"
          />
          <circle
            cx="308.47"
            cy="-26.23"
            r="6"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-45 dark:opacity-75"
          />
          <circle
            cx="308.47"
            cy="-26.23"
            r="2"
            fill="currentColor"
            className="opacity-80 dark:opacity-100"
          />
        </g>

        {/* Hero Middle Ring Orbit (Clockwise luminous beam) */}
        <g className="ring-orbit-hero text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M 500 80 A 420 420 0 0 1 894.67 356.35"
            fill="none"
            stroke="url(#orbit-glow-420)"
            strokeWidth="7"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-65 dark:opacity-90"
          />
          <path
            d="M 500 80 A 420 420 0 0 1 894.67 356.35"
            fill="none"
            stroke="url(#orbit-glow-420)"
            strokeWidth="2"
            strokeLinecap="round"
            className="opacity-90 dark:opacity-100"
          />
          <circle
            cx="894.67"
            cy="356.35"
            r="9"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-65 dark:opacity-95"
          />
          <circle
            cx="894.67"
            cy="356.35"
            r="3"
            fill="currentColor"
            className="opacity-95 dark:opacity-100"
          />
        </g>

        {/* Inner Ring Orbit (Counter-clockwise orbital pulse) */}
        <g className="ring-orbit-inner text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M 500 780 A 280 280 0 0 1 270.64 660.6"
            fill="none"
            stroke="url(#orbit-glow-280)"
            strokeWidth="6"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-55 dark:opacity-80"
          />
          <path
            d="M 500 780 A 280 280 0 0 1 270.64 660.6"
            fill="none"
            stroke="url(#orbit-glow-280)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="opacity-80 dark:opacity-95"
          />
          <circle
            cx="270.64"
            cy="660.6"
            r="7"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-55 dark:opacity-85"
          />
          <circle
            cx="270.64"
            cy="660.6"
            r="2.25"
            fill="currentColor"
            className="opacity-90 dark:opacity-100"
          />
        </g>
      </svg>
    </div>
  )
}

function HeaderBar() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
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
  )
}

function Login() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: "/login" })
  const { status, login, setup } = useAdminAuth()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<LoginMode>("password")
  const [password, setPassword] = useState("")
  const [token, setToken] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const submitButtonRef = useRef<HTMLButtonElement>(null)

  const setupRequired = status.data?.setup_required ?? false
  // A fresh install has no customer, so the mode switch stays hidden and the
  // setup form always applies.
  const usingToken = !setupRequired && mode === "token"

  // The provider already refreshes the cached status on success; this only
  // lands the operator back on the screen the guard bounced them off.
  const afterAuth = () => navigate({ to: redirect ?? "/", replace: true })

  if (status.isPending) {
    return (
      <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background text-foreground">
        <BackgroundRings />
        <HeaderBar />

        <main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-6">
          <div
            className="pointer-events-none absolute z-0 size-[32rem] rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.01)_40%,transparent_70%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_40%,transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative z-1 w-full max-w-[24.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.05),0_10px_24px_-4px_rgba(0,0,0,0.06)] dark:border-white/12 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_16px_36px_-6px_rgba(0,0,0,0.65)]">
            <div className="flex flex-col items-center justify-center gap-3.5 p-10 text-center">
              <div className="size-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
              <p className="m-0 text-sm text-muted-foreground">
                Connecting to gateway...
              </p>
            </div>
          </div>
        </main>

        <footer className="relative z-10 flex items-center justify-between px-5 py-4 text-xs text-muted-foreground sm:px-8 sm:py-5">
          <div className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-warning" />
            <span>Connecting</span>
          </div>
          <span>Operator authentication</span>
        </footer>
      </div>
    )
  }

  if (status.isError) {
    return (
      <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background text-foreground">
        <BackgroundRings />
        <HeaderBar />

        <main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-6">
          <div
            className="pointer-events-none absolute z-0 size-[32rem] rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.01)_40%,transparent_70%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_40%,transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative z-1 w-full max-w-[24.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.05),0_10px_24px_-4px_rgba(0,0,0,0.06)] dark:border-white/12 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_16px_36px_-6px_rgba(0,0,0,0.65)]">
            <div className="flex flex-col gap-6 p-5 sm:p-7">
              <div className="flex flex-col gap-1.5">
                <h1 className="m-0 text-xl font-medium tracking-tight text-foreground">
                  Could not reach the server
                </h1>
                <p className="m-0 text-sm leading-[1.45] text-muted-foreground">
                  {describe(status.error)}
                </p>
              </div>
              <ActionButton
                className="!min-h-11 !w-full !cursor-pointer !rounded-lg !text-sm !font-medium !tracking-tight transition-colors duration-150 focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-foreground dark:not-disabled:!border-white dark:not-disabled:!bg-white dark:not-disabled:!text-black dark:hover:not-disabled:!bg-zinc-100 dark:disabled:!cursor-not-allowed dark:disabled:!border-white/8 dark:disabled:!bg-white/6 dark:disabled:!text-white/35 dark:disabled:!opacity-100"
                label="Retry"
                pendingLabel="Connecting..."
                successLabel="Connected"
                onAction={async () => {
                  try {
                    const res = await status.refetch()
                    if (res.isError) {
                      toast.error(describe(res.error))
                      throw res.error
                    }
                  } catch (err) {
                    toast.error(describe(err as Error))
                    throw err
                  }
                }}
              />
            </div>
          </div>
        </main>

        <footer className="relative z-10 flex items-center justify-between px-5 py-4 text-xs text-muted-foreground sm:px-8 sm:py-5">
          <div className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-danger" />
            <span>Server offline</span>
          </div>
          <span>Operator authentication</span>
        </footer>
      </div>
    )
  }

  const active = setupRequired ? setup : login
  const mismatch =
    setupRequired && confirmation.length > 0 && confirmation !== password

  const handleAuth = async () => {
    if (usingToken) {
      if (token.length === 0) return

      try {
        await loginPortal(token)
        // Either role can leave the shared cookie behind, so a token sign-in
        // must refresh both caches before the console's gate reads them.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["portal"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "status"] }),
        ])
        toast.success("Signed in successfully")
        await navigate({ to: "/portal", replace: true })
      } catch (error) {
        toast.error(describe(error as Error))
        throw error
      }
      return
    }

    if (password.length === 0) return
    if (setupRequired && (confirmation.length === 0 || mismatch)) return

    try {
      if (setupRequired) {
        await setup.mutateAsync(
          { password, confirmation },
          { onSuccess: afterAuth }
        )
        toast.success("Admin password created")
        return
      }
      await login.mutateAsync({ password }, { onSuccess: afterAuth })
      toast.success("Signed in successfully")
    } catch (error) {
      toast.error(describe(error as Error))
      throw error
    }
  }

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background text-foreground">
      <BackgroundRings />
      <HeaderBar />

      <main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-6">
        <div
          className="pointer-events-none absolute z-0 size-[32rem] rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.01)_40%,transparent_70%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_40%,transparent_70%)]"
          aria-hidden="true"
        />
        <motion.div
          className="relative z-1 w-full max-w-[24.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.05),0_10px_24px_-4px_rgba(0,0,0,0.06)] dark:border-white/12 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_16px_36px_-6px_rgba(0,0,0,0.65)]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="flex flex-col gap-6 p-5 sm:p-7">
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 text-xl font-medium tracking-tight text-foreground">
                {setupRequired ? "Create admin password" : "Sign in to SRouter"}
              </h1>
              <p className="m-0 text-sm leading-[1.45] text-muted-foreground">
                {setupRequired
                  ? "Set the master password to initialize and secure this gateway."
                  : usingToken
                    ? "Enter the access token issued by the operator to open your account console."
                    : "Enter the operator password to access the gateway console."}
              </p>
            </div>

            <form
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                const submitter = (event.nativeEvent as SubmitEvent)?.submitter
                if (submitter !== submitButtonRef.current) {
                  submitButtonRef.current?.click()
                }
              }}
            >
              {!setupRequired && (
                <SegmentedControl
                  options={LOGIN_MODE_OPTIONS}
                  value={mode}
                  onValueChange={(value) => setMode(value as LoginMode)}
                  label="Sign-in method"
                />
              )}

              <div className="flex flex-col gap-5">
                {usingToken ? (
                  <PasswordField
                    id="token"
                    label="Access token"
                    autoComplete="off"
                    autoFocus
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                ) : (
                  <PasswordField
                    id="password"
                    label={setupRequired ? "Master password" : "Password"}
                    autoComplete={
                      setupRequired ? "new-password" : "current-password"
                    }
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}

                {setupRequired ? (
                  <PasswordField
                    id="confirmation"
                    label="Confirm master password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    aria-invalid={mismatch ? true : undefined}
                    description={mismatch ? "Passwords must match." : undefined}
                  />
                ) : null}
              </div>

              <div className="mt-1">
                <ActionButton
                  ref={submitButtonRef}
                  type="submit"
                  className="!min-h-11 !w-full !cursor-pointer !rounded-lg !text-sm !font-medium !tracking-tight transition-colors duration-150 focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-foreground dark:not-disabled:!border-white dark:not-disabled:!bg-white dark:not-disabled:!text-black dark:hover:not-disabled:!bg-zinc-100 dark:disabled:!cursor-not-allowed dark:disabled:!border-white/8 dark:disabled:!bg-white/6 dark:disabled:!text-white/35 dark:disabled:!opacity-100"
                  label={setupRequired ? "Create admin password" : "Sign in"}
                  pendingLabel={setupRequired ? "Creating..." : "Signing in..."}
                  successLabel={setupRequired ? "Created" : "Signed in"}
                  shortcut="↵"
                  disabled={
                    (usingToken ? token.length === 0 : password.length === 0) ||
                    (setupRequired &&
                      (confirmation.length === 0 || mismatch)) ||
                    active.isPending
                  }
                  onAction={handleAuth}
                />
              </div>
            </form>
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 flex items-center justify-between px-5 py-4 text-xs text-muted-foreground sm:px-8 sm:py-5">
        <div className="inline-flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-success" />
          <span>Gateway online</span>
        </div>
        <span>
          {usingToken ? "Customer authentication" : "Operator authentication"}
        </span>
      </footer>
    </div>
  )
}
