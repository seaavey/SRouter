import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"

import { adminStatusQuery } from "@/api/admin"
import { loginPortal } from "@/api/portal"
import { PasswordField } from "@/components/arc/password-field/password-field"
import { toast } from "@/components/arc/toast-stack/toast-stack"

import AuthCard from "../AuthCard"
import AuthForm from "../AuthForm"
import describeError from "../describe-error"

type UserSignInProps = {
  /** The method toggle, so the customer can go back to the operator card. */
  methodSwitch: ReactNode
}

/**
 * The customer card: the access token the operator issued opens the account
 * console, and the server swaps it for the same session cookie the operator
 * uses.
 */
export default function UserSignIn({ methodSwitch }: UserSignInProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [token, setToken] = useState("")

  async function handleAuth() {
    if (token.length === 0) return

    try {
      await loginPortal(token)
      // Either role can leave the shared cookie behind, so a token sign-in
      // must clear the previous tenant's console and refresh the operator
      // status before the portal gate reads either cache.
      queryClient.removeQueries({ queryKey: ["portal"] })
      await queryClient.invalidateQueries({
        queryKey: adminStatusQuery.queryKey,
      })
      toast.success("Signed in successfully")
      await navigate({ to: "/portal", replace: true })
    } catch (error) {
      toast.error(describeError(error instanceof Error ? error : null))
      throw error
    }
  }

  return (
    <AuthCard
      title="Sign in to SRouter"
      description="Enter the access token issued by the operator to open your account console."
    >
      <AuthForm
        methodSwitch={methodSwitch}
        disabled={token.length === 0}
        onAction={handleAuth}
        pendingLabel="Signing in..."
        submitLabel="Sign in"
        successLabel="Signed in"
      >
        <PasswordField
          id="token"
          label="Access token"
          autoComplete="off"
          autoFocus
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </AuthForm>
    </AuthCard>
  )
}
