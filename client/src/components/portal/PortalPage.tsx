import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useRef } from "react"

import { APIError } from "@/api/client"
import { logoutPortal, portalMeQuery } from "@/api/portal"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { MONEY, NUMBER } from "@/components/usage/types"

import PortalKeys from "./PortalKeys"
import PortalLogs from "./PortalLogs"

const PORTAL_AUTH_CHANNEL = "srouter-portal-auth"
const SIGNED_OUT = "signed-out"

export default function PortalPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery(portalMeQuery)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const signingOutRef = useRef(false)

  // Every D12 sign-out path ends here: a 401 on any portal query, another
  // tab's message, and this tab's own button all clear the console the same way.
  const signOut = useCallback(() => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    queryClient.removeQueries({ queryKey: ["portal"] })
    void queryClient.invalidateQueries({ queryKey: ["admin", "status"] })
    void navigate({ to: "/login", replace: true })
  }, [navigate, queryClient])

  useEffect(() => {
    const channel = new BroadcastChannel(PORTAL_AUTH_CHANNEL)
    channelRef.current = channel
    const handleMessage = (event: MessageEvent) => {
      if (event.data === SIGNED_OUT) signOut()
    }
    channel.addEventListener("message", handleMessage)
    return () => {
      channel.removeEventListener("message", handleMessage)
      channel.close()
      channelRef.current = null
    }
  }, [signOut])

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const { query: cached } = event
        if (cached.queryKey[0] !== "portal") return
        const error = cached.state.error
        if (error instanceof APIError && error.isUnauthenticated) signOut()
      }),
    [queryClient, signOut]
  )

  async function handleSignOut() {
    try {
      await logoutPortal()
    } catch (error) {
      // A session the server already dropped still has to leave this screen.
      if (!(error instanceof APIError && error.isUnauthenticated)) throw error
    }
    channelRef.current?.postMessage(SIGNED_OUT)
    signOut()
  }

  async function retry() {
    const result = await query.refetch()
    if (result.isError) throw result.error
  }

  const me = query.data

  if (!me) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
          {query.isError ? (
            <Alert tone="danger" title="Could not load your account">
              <span className="flex flex-col items-start gap-3">
                <span className="break-words">
                  {query.error instanceof Error
                    ? query.error.message
                    : "The portal endpoint could not be reached."}
                </span>
                <ActionButton
                  label="Retry"
                  pendingLabel="Retrying"
                  successLabel="Loaded"
                  onAction={retry}
                />
              </span>
            </Alert>
          ) : (
            <Skeleton label="Loading your account" lines={5} />
          )}
        </main>
      </div>
    )
  }

  const totals = me.keys.reduce(
    (sum, key) => ({
      tokens: sum.tokens + key.usage_tokens,
      spend: sum.spend + (key.usage_cost ?? 0),
      credit: sum.credit + (key.credit_limit ?? 0),
      // One uncapped key makes the sum a subtotal, not an account limit.
      uncapped: sum.uncapped || !key.credit_limit,
    }),
    { tokens: 0, spend: 0, credit: 0, uncapped: false }
  )

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:px-6 sm:py-8">
        <section
          aria-labelledby="portal-account-heading"
          className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                id="portal-account-heading"
                className="text-lg font-medium tracking-tight text-foreground"
              >
                My account
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {me.user.name}
              </p>
            </div>

            <ActionButton
              label="Sign out"
              pendingLabel="Signing out"
              successLabel="Signed out"
              onAction={handleSignOut}
              onActionError={(error) =>
                toast.error("Could not sign out", {
                  description:
                    error instanceof Error ? error.message : undefined,
                })
              }
            />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-3">
            <div>
              <dt className="text-xs text-muted-foreground">Tokens used</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
                {NUMBER.format(totals.tokens)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Spend</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
                {MONEY.format(totals.spend)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Credit limit</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
                {totals.uncapped || totals.credit === 0
                  ? "No cap"
                  : MONEY.format(totals.credit)}
              </dd>
            </div>
          </dl>
        </section>

        <PortalKeys keys={me.keys} />
        <PortalLogs />
      </main>
    </div>
  )
}
