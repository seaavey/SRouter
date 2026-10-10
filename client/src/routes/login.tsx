import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"

import { APIError } from "@/api/client"
import { useAdminAuth } from "@/components/admin-auth-provider"
import { Button } from "@/components/ui/button"

type LoginSearch = { redirect?: string }

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

function Login() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: "/login" })
  const { status, login, setup } = useAdminAuth()

  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")

  const setupRequired = status.data?.setup_required ?? false

  // The provider already refreshes the cached status on success; this only
  // lands the operator back on the screen the guard bounced them off.
  const afterAuth = () => navigate({ to: redirect ?? "/", replace: true })

  if (status.isPending) {
    return (
      <p className="p-6 text-xs text-muted-foreground">Checking session…</p>
    )
  }

  if (status.isError) {
    return (
      <div className="p-6">
        <h1 className="text-sm font-medium">Could not reach the server</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {describe(status.error)}
        </p>
        <Button className="mt-3" size="sm" onClick={() => status.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const active = setupRequired ? setup : login
  const mismatch =
    setupRequired && confirmation.length > 0 && confirmation !== password

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-3 p-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (setupRequired) {
          setup.mutate({ password, confirmation }, { onSuccess: afterAuth })
          return
        }
        login.mutate({ password }, { onSuccess: afterAuth })
      }}
    >
      <div>
        <h1 className="text-sm font-medium">
          {setupRequired ? "Create the admin account" : "Sign in"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {setupRequired
            ? "This instance has no admin account yet. The password you set here is the one that protects it."
            : "The admin session lasts seven days."}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Password</span>
        <input
          type="password"
          autoComplete={setupRequired ? "new-password" : "current-password"}
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>

      {setupRequired ? (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      ) : null}

      {active.isError ? (
        <p className="text-xs text-destructive">{describe(active.error)}</p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        disabled={password.length === 0 || mismatch || active.isPending}
      >
        {active.isPending
          ? "Working…"
          : setupRequired
            ? "Create account"
            : "Sign in"}
      </Button>
    </form>
  )
}
