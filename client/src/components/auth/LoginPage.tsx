import { useState } from "react"

import { useAdminAuth } from "@/components/admin-auth-provider"
import ActionButton from "@/components/arc/action-button/action-button"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { toast } from "@/components/arc/toast-stack/toast-stack"

import AdminSignIn from "./admin/AdminSignIn"
import AuthCard from "./AuthCard"
import AuthShell from "./AuthShell"
import describeError from "./describe-error"
import { AUTH_BUTTON_CLASS, LOGIN_MODE_OPTIONS, type LoginMode } from "./types"
import UserSignIn from "./user/UserSignIn"

type LoginPageProps = {
  /** Where the operator lands after signing in. */
  redirect?: string
}

/**
 * The sign-in screen. One card serves both audiences: the operator signs in
 * with the master password (or creates it on a fresh install), and a customer
 * signs in with the access token the operator issued them.
 */
export default function LoginPage({ redirect }: LoginPageProps) {
  const { status } = useAdminAuth()
  const [mode, setMode] = useState<LoginMode>("password")

  const setupRequired = status.data?.setup_required ?? false
  // A fresh install has no customer, so the mode switch stays hidden and the
  // setup form always applies.
  const usingToken = !setupRequired && mode === "token"

  if (status.isPending) {
    return (
      <AuthShell audience="operator" connection="connecting">
        <div className="flex flex-col items-center justify-center gap-3.5 p-10 text-center">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <p className="m-0 text-sm text-muted-foreground">
            Connecting to gateway...
          </p>
        </div>
      </AuthShell>
    )
  }

  if (status.isError) {
    return (
      <AuthShell audience="operator" connection="offline">
        <AuthCard
          title="Could not reach the server"
          description={describeError(status.error)}
        >
          <ActionButton
            className={AUTH_BUTTON_CLASS}
            label="Retry"
            pendingLabel="Connecting..."
            successLabel="Connected"
            onAction={async () => {
              try {
                const res = await status.refetch()
                if (res.isError) {
                  toast.error(describeError(res.error))
                  throw res.error
                }
              } catch (error) {
                toast.error(
                  describeError(error instanceof Error ? error : null)
                )
                throw error
              }
            }}
          />
        </AuthCard>
      </AuthShell>
    )
  }

  const methodSwitch = (
    <SegmentedControl
      options={LOGIN_MODE_OPTIONS}
      value={mode}
      onValueChange={(next) => {
        if (next === "password" || next === "token") {
          setMode(next)
        }
      }}
      label="Sign-in method"
    />
  )

  // The card frame and the method switch stay mounted across the audience
  // swap, so the selection glides to the new option instead of remounting at
  // the far end. Only the fields and the action below it are per-audience.
  const copy = setupRequired
    ? {
        title: "Create admin password",
        description:
          "Set the master password to initialize and secure this gateway.",
      }
    : usingToken
      ? {
          title: "Sign in to SRouter",
          description:
            "Enter the access token issued by the operator to open your account console.",
        }
      : {
          title: "Sign in to SRouter",
          description:
            "Enter the operator password to access the gateway console.",
        }

  return (
    <AuthShell
      audience={usingToken ? "customer" : "operator"}
      connection="online"
    >
      <AuthCard title={copy.title} description={copy.description}>
        <div className="flex flex-col gap-5">
          {setupRequired ? null : methodSwitch}
          {usingToken ? (
            <UserSignIn />
          ) : (
            <AdminSignIn redirect={redirect} setupRequired={setupRequired} />
          )}
        </div>
      </AuthCard>
    </AuthShell>
  )
}
