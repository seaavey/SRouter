import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"

import { adminStatusQuery } from "@/api/admin"
import { APIError, request } from "@/api/client"
import { Button } from "@/components/ui/button"

type LoginSearch = { redirect?: string }

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Login,
})

/** Turns a failed login into the one sentence the operator needs. */
function describe(error: unknown) {
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
  const queryClient = useQueryClient()
  const { redirect } = useSearch({ from: "/login" })
  const status = useQuery(adminStatusQuery)

  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")

  const setupRequired = status.data?.setup_required ?? false

  // Both forms end the same way: the server sets the session cookie, then the
  // cached status is refreshed so the guard sees `authenticated: true`.
  const afterAuth = async () => {
    await queryClient.invalidateQueries({ queryKey: adminStatusQuery.queryKey })
    await navigate({ to: redirect ?? "/", replace: true })
  }

  const login = useMutation({
    mutationFn: () => request<{ authenticated: boolean }>("/v1/admin/login", { method: "POST", body: { password } }),
    onSuccess: afterAuth,
  })

  const setup = useMutation({
    mutationFn: () =>
      request<{ authenticated: boolean }>("/v1/admin/setup", {
        method: "POST",
        body: { password, confirmation },
      }),
    onSuccess: afterAuth,
  })

  if (status.isPending) {
    return <p className="text-muted-foreground p-6 text-xs">Checking session…</p>
  }

  if (status.isError) {
    return (
      <div className="p-6">
        <h1 className="text-sm font-medium">Could not reach the server</h1>
        <p className="text-muted-foreground mt-1 text-xs">{describe(status.error)}</p>
        <Button className="mt-3" size="sm" onClick={() => status.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const active = setupRequired ? setup : login
  const mismatch = setupRequired && confirmation.length > 0 && confirmation !== password

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-3 p-6"
      onSubmit={(event) => {
        event.preventDefault()
        active.mutate()
      }}
    >
      <div>
        <h1 className="text-sm font-medium">
          {setupRequired ? "Create the admin account" : "Sign in"}
        </h1>
        <p className="text-muted-foreground mt-1 text-xs">
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
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-7 rounded-md border px-2 outline-none focus-visible:ring-2"
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
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-7 rounded-md border px-2 outline-none focus-visible:ring-2"
          />
        </label>
      ) : null}

      {active.isError ? (
        <p className="text-destructive text-xs">{describe(active.error)}</p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        disabled={password.length === 0 || mismatch || active.isPending}
      >
        {active.isPending ? "Working…" : setupRequired ? "Create account" : "Sign in"}
      </Button>
    </form>
  )
}
