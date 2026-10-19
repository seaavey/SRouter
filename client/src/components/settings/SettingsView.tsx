import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"

import { exportDatabase } from "@/api/database"
import { settingsQuery, systemQuery, updateSettings } from "@/api/settings"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { Switch } from "@/components/arc/switch/switch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { useAdminAuth } from "@/components/admin-auth-provider"
import { SectionHeader } from "@/components/layout/section-header"

import { ChangePasswordDialog } from "./ChangePasswordDialog"
import { RestoreDatabaseDialog } from "./RestoreDatabaseDialog"

/** One surface per section; the page gutter belongs to the shell. */
const SURFACE =
  "min-w-0 rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--shadow-resting)]"

export function SettingsView() {
  const id = useId()
  const queryClient = useQueryClient()
  const settings = useQuery(settingsQuery)
  const system = useQuery(systemQuery)
  const { logout } = useAdminAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const policy = useMutation({
    mutationFn: updateSettings,
    // The PATCH answers with the whole settings object, so the cache takes the
    // server's copy rather than a guess, and a failure leaves the old value.
    onSuccess: (next) => queryClient.setQueryData(settingsQuery.queryKey, next),
    onError: (error) => {
      toast.error("Could not change the access policy", {
        description: error instanceof Error ? error.message : undefined,
      })
    },
    // The write above is exact; the invalidation is what catches a server-side
    // side effect the response body does not carry.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey })
    },
  })

  async function retrySettings() {
    const result = await settings.refetch()
    if (result.error) throw result.error
  }

  async function retrySystem() {
    const result = await system.refetch()
    if (result.error) throw result.error
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-8">
      <SectionHeader
        title="Settings"
        description="Admin credentials, the gateway access policy, the session, and the local database this install serves from."
        badge={system.data ? `v${system.data.version}` : undefined}
      />

      <section aria-labelledby={`${id}-access`} className={SURFACE}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2
            id={`${id}-access`}
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Access policy
          </h2>
        </div>

        {settings.isPending ? (
          <div className="px-4 py-4 sm:px-5">
            <Skeleton label="Loading the access policy" lines={2} />
          </div>
        ) : settings.isError ? (
          <div className="px-4 py-4 sm:px-5">
            <Alert tone="danger" title="Could not load the access policy">
              <span className="flex flex-col items-start gap-3">
                <span className="break-words">
                  {settings.error instanceof Error
                    ? settings.error.message
                    : "The settings endpoint could not be reached."}
                </span>
                <ActionButton
                  label="Retry"
                  pendingLabel="Retrying"
                  successLabel="Loaded"
                  onAction={retrySettings}
                  className="!border-border !bg-surface !text-foreground"
                />
              </span>
            </Alert>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <p id={`${id}-policy`} className="text-sm text-foreground">
                Require an API key
              </p>
              <p
                id={`${id}-policy-hint`}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                While this is on, a request is refused unless it carries a
                gateway key or an admin session.
              </p>
            </div>
            <Switch
              checked={settings.data?.require_api_key ?? false}
              disabled={policy.isPending}
              onCheckedChange={(require_api_key) =>
                policy.mutate({ require_api_key })
              }
              aria-labelledby={`${id}-policy`}
              aria-describedby={`${id}-policy-hint`}
            />
          </div>
        )}
      </section>

      <section aria-labelledby={`${id}-password`} className={SURFACE}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2
            id={`${id}-password`}
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Admin password
          </h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="min-w-0 text-xs text-muted-foreground">
            Protects the operator surfaces, including key issuance and database
            restore.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setPasswordOpen(true)}
          >
            Change password
          </Button>
        </div>
      </section>

      <section aria-labelledby={`${id}-database`} className={SURFACE}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2
            id={`${id}-database`}
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Database
          </h2>
        </div>
        <div className="divide-y divide-border">
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Backup and restore</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Export downloads a snapshot of the SQLite file. Restoring
                replaces every row and signs you out.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ActionButton
                label="Export database"
                pendingLabel="Preparing export"
                successLabel="Saved"
                onAction={exportDatabase}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRestoreOpen(true)}
              >
                Restore from backup
              </Button>
            </div>
          </div>

          {system.isError ? (
            <div className="px-4 py-3.5 sm:px-5">
              <Alert tone="danger" title="Could not load the database facts">
                <span className="flex flex-col items-start gap-3">
                  <span className="break-words">
                    {system.error instanceof Error
                      ? system.error.message
                      : "The system endpoint could not be reached."}
                  </span>
                  <ActionButton
                    label="Retry"
                    pendingLabel="Retrying"
                    successLabel="Loaded"
                    onAction={retrySystem}
                    className="!border-border !bg-surface !text-foreground"
                  />
                </span>
              </Alert>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
                <p className="shrink-0 text-sm text-foreground">
                  Database file
                </p>
                {system.isPending ? (
                  <Skeleton
                    label="Loading the database file"
                    className="w-48"
                  />
                ) : (
                  <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">
                    {system.data?.database_path}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
                <p className="text-sm text-foreground">Schema version</p>
                {system.isPending ? (
                  <Skeleton
                    label="Loading the schema version"
                    className="w-8"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {system.data?.schema_version}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby={`${id}-session`} className={SURFACE}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2
            id={`${id}-session`}
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Session
          </h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="min-w-0 text-xs text-muted-foreground">
            The session cookie this browser holds. Signing out clears it here
            and on the server.
          </p>
          <ActionButton
            label="Sign out"
            pendingLabel="Signing out"
            successLabel="Signed out"
            className="shrink-0 !border-border !bg-surface !text-foreground"
            onAction={async () => {
              await logout.mutateAsync()
              window.location.assign("/login")
            }}
          />
        </div>
      </section>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
      <RestoreDatabaseDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </div>
  )
}
