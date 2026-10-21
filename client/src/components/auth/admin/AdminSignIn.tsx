import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"

import { useAdminAuth } from "@/components/admin-auth-provider"
import { PasswordField } from "@/components/arc/password-field/password-field"
import { toast } from "@/components/arc/toast-stack/toast-stack"

import AuthCard from "../AuthCard"
import AuthForm from "../AuthForm"
import describeError from "../describe-error"

type AdminSignInProps = {
  /** The method toggle, or null while the install has no password yet. */
  methodSwitch: ReactNode
  /** Where the operator lands after signing in. */
  redirect?: string
  /** The install has no master password yet, so the card creates one. */
  setupRequired: boolean
}

/**
 * The operator card: the master password signs the gateway owner in, and a
 * fresh install has the operator create that password first.
 */
export default function AdminSignIn({
  methodSwitch,
  redirect,
  setupRequired,
}: AdminSignInProps) {
  const navigate = useNavigate()
  const { login, setup } = useAdminAuth()
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")

  const mismatch =
    setupRequired && confirmation.length > 0 && confirmation !== password
  const active = setupRequired ? setup : login

  // The provider already refreshes the cached status on success; this only
  // lands the operator back on the screen the guard bounced them off.
  const afterAuth = () => navigate({ to: redirect ?? "/", replace: true })

  async function handleAuth() {
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
      toast.error(describeError(error instanceof Error ? error : null))
      throw error
    }
  }

  return (
    <AuthCard
      title={setupRequired ? "Create admin password" : "Sign in to SRouter"}
      description={
        setupRequired
          ? "Set the master password to initialize and secure this gateway."
          : "Enter the operator password to access the gateway console."
      }
    >
      <AuthForm
        methodSwitch={methodSwitch}
        disabled={
          password.length === 0 ||
          (setupRequired && (confirmation.length === 0 || mismatch)) ||
          active.isPending
        }
        onAction={handleAuth}
        pendingLabel={setupRequired ? "Creating..." : "Signing in..."}
        submitLabel={setupRequired ? "Create admin password" : "Sign in"}
        successLabel={setupRequired ? "Created" : "Signed in"}
      >
        <PasswordField
          id="password"
          label={setupRequired ? "Master password" : "Password"}
          autoComplete={setupRequired ? "new-password" : "current-password"}
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

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
      </AuthForm>
    </AuthCard>
  )
}
