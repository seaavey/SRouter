import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"

import { adminStatusQuery } from "@/api/admin"
import { ApiError, request } from "@/api/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

type LoginSearch = { redirect?: string }

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Login,
})

/** Turns a failed request into the one sentence the operator needs. */
function describe(error: unknown) {
  if (!(error instanceof ApiError)) {
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
    mutationFn: () =>
      request<{ authenticated: boolean }>("/v1/admin/login", {
        method: "POST",
        body: { password },
      }),
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
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center gap-2 text-xs">
        <Spinner />
        Checking session
      </div>
    )
  }

  if (status.isError) {
    return (
      <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-3 p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not reach the server</AlertTitle>
          <AlertDescription>{describe(status.error)}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => status.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const active = setupRequired ? setup : login
  const mismatch = setupRequired && confirmation.length > 0 && confirmation !== password

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          active.mutate()
        }}
      >
        <FieldGroup>
          <div className="flex flex-col gap-1">
            <h1 className="text-sm font-medium">
              {setupRequired ? "Create the admin account" : "Sign in"}
            </h1>
            <p className="text-muted-foreground text-xs">
              {setupRequired
                ? "This instance has no admin account yet. The password you set here is the one that protects it."
                : "The admin session lasts seven days."}
            </p>
          </div>

          <Field data-invalid={active.isError ? true : undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete={setupRequired ? "new-password" : "current-password"}
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={active.isError ? true : undefined}
            />
            {active.isError ? <FieldError>{describe(active.error)}</FieldError> : null}
          </Field>

          {setupRequired ? (
            <Field data-invalid={mismatch ? true : undefined}>
              <FieldLabel htmlFor="confirmation">Confirm password</FieldLabel>
              <Input
                id="confirmation"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={mismatch ? true : undefined}
              />
              {mismatch ? (
                <FieldError>Both passwords must match.</FieldError>
              ) : (
                <FieldDescription>Repeat the password to rule out a typo.</FieldDescription>
              )}
            </Field>
          ) : null}

          <Button
            type="submit"
            disabled={password.length === 0 || mismatch || active.isPending}
          >
            {active.isPending ? <Spinner data-icon="inline-start" /> : null}
            {setupRequired ? "Create account" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  )
}
