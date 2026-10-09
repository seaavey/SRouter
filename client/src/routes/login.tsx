import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router"
import { useState } from "react"

import { request } from "@/shared/api/client"
import { adminStatusQuery } from "@/shared/api/queries"
import { describeError, PendingState } from "@/shared/components/states"
import { Button } from "@/shared/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"
import { Spinner } from "@/shared/components/ui/spinner"

export const Route = createFileRoute("/login")({
  // `redirect` is absent rather than `undefined` when there is nothing to
  // resume, so navigating to `/login` needs no search object at all.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: Login,
})

/**
 * The setup form and the login form are the same screen in two states: the
 * server reports `setup_required` when it has no admin account yet, and only
 * then is a confirmation field shown.
 */
function Login() {
  const navigate = useNavigate()
  const router = useRouter()
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
    if (redirect) {
      // The guard stored a full href (path plus search), so it is replayed as
      // history rather than decomposed into a `to` and a search object.
      router.history.push(redirect)
      return
    }

    await navigate({ to: "/", search: {}, replace: true })
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
      <div className="flex min-h-svh items-center justify-center">
        <PendingState label="Checking session" />
      </div>
    )
  }

  if (status.isError) {
    return (
      <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-3 p-6">
        <p className="text-sm font-medium">Could not reach the server</p>
        <p className="text-destructive text-xs">{describeError(status.error)}</p>
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
            {active.isError ? (
              <FieldError>{describeError(active.error)}</FieldError>
            ) : null}
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
                <FieldDescription>
                  Repeat the password to rule out a typo.
                </FieldDescription>
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
