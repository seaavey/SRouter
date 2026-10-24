import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import type { ReactNode } from "react"

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
  "min-w-0 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--shadow-resting)]"

/**
 * A settings row: the section's name on the left at the laptop tier, the control
 * in the panel on the right. Sections are separated by a hairline and air rather
 * than a box each, so four sections do not read as four widgets.
 */
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const id = useId()

  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 gap-3 border-t border-border pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-8"
    >
      <div className="min-w-0">
        <h2
          id={id}
          className="text-sm font-medium tracking-tight text-foreground"
        >
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  )
}

export function SettingsView() {
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
    <div className="flex w-full max-w-[880px] flex-col gap-6">
      <SectionHeader
        title="Settings"
        description="Admin credentials, the gateway access policy, the session, and the local database this install serves from."
        badge={system.data ? `v${system.data.version}` : undefined}
      />

      <div className="flex flex-col gap-6">
        <SettingsSection
          title="Access policy"
          description="Who may call the gateway at all."
        >
          <div className={SURFACE}>
            {settings.isPending ? (
              <div
                className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5"
                aria-hidden="true"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Skeleton className="max-w-[9rem]" lines={1} />
                  <Skeleton className="max-w-[16rem]" lines={1} />
                </div>
                <div className="h-6 w-[42px] shrink-0 rounded-full bg-surface-muted" />
              </div>
            ) : settings.isError ? (
              <div className="px-4 py-3.5 sm:px-5">
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
              <SettingRow
                title="Require an API key"
                hint="While this is on, a request is refused unless it carries a gateway key or an admin session."
              >
                <Switch
                  checked={settings.data?.require_api_key ?? false}
                  disabled={policy.isPending}
                  onCheckedChange={(require_api_key) =>
                    policy.mutate({ require_api_key })
                  }
                  aria-label="Require an API key for gateway requests"
                />
              </SettingRow>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Admin password"
          description="The operator credential."
        >
          <div className={SURFACE}>
            <SettingRow
              title="Change password"
              hint="Protects the operator surfaces, including key issuance and database restore."
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPasswordOpen(true)}
              >
                Change password
              </Button>
            </SettingRow>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Database"
          description="The SQLite file this install serves from."
        >
          <div className={`${SURFACE} divide-y divide-border`}>
            <SettingRow
              title="Backup"
              hint="Downloads a snapshot of the SQLite file."
            >
              <ActionButton
                label="Export database"
                pendingLabel="Preparing export"
                successLabel="Saved"
                onAction={exportDatabase}
              />
            </SettingRow>

            <SettingRow
              title="Restore"
              hint="Replaces every row in the database, then signs you out."
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRestoreOpen(true)}
              >
                Restore from backup
              </Button>
            </SettingRow>

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
                <div className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5">
                  <p className="shrink-0 text-sm text-foreground">
                    Database file
                  </p>
                  {system.isPending ? (
                    <Skeleton
                      label="Loading the database file"
                      className="sm:w-64"
                    />
                  ) : (
                    <span
                      className="min-w-0 font-mono text-xs break-all text-muted-foreground sm:text-right"
                      title={system.data?.database_path}
                    >
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
        </SettingsSection>

        <SettingsSection
          title="Session"
          description="The cookie this browser holds."
        >
          <div className={SURFACE}>
            <SettingRow
              title="Sign out"
              hint="Clears the session cookie here and on the server."
            >
              <ActionButton
                label="Sign out"
                pendingLabel="Signing out"
                successLabel="Signed out"
                className="!border-border !bg-surface !text-foreground"
                onAction={async () => {
                  await logout.mutateAsync()
                  window.location.assign("/login")
                }}
              />
            </SettingRow>
          </div>
        </SettingsSection>
      </div>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
      <RestoreDatabaseDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </div>
  )
}
