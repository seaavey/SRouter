import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil, RotateCcw, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { APIError } from "@/api/client"
import {
  deleteAPIKey,
  keyListQuery,
  regenerateAPIKey,
  updateAPIKey,
} from "@/api/keys"
import type { APIKeyResponse, KeyListResponse, UserResponse } from "@/api/types"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import { SplitButton } from "@/components/arc/split-button/split-button"
import { Switch } from "@/components/arc/switch/switch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { ShareBar } from "@/components/usage/ShareBar"
import { COMPACT, NUMBER, percent, SPEND } from "@/components/usage/types"

import { RegenerateKeyDialog } from "./RegenerateKeyDialog"
import { RevokeKeyDialog } from "./RevokeKeyDialog"

type KeysTableProps = {
  keys: APIKeyResponse[]
  users: UserResponse[]
  onEditKey: (key: APIKeyResponse) => void
}

type ToggleInput = { keyID: string; enabled: boolean }

const quotaTone = (pct: number) =>
  pct >= 100 ? "danger" : pct >= 80 ? "warning" : "neutral"

const quotaText = (pct: number) =>
  pct >= 100 ? "text-danger" : pct >= 80 ? "text-warning" : "text-foreground"

/** A key on a big budget can sit at 0.0035%, where "0.0%" reads as no usage. */
const quotaPercent = (pct: number) =>
  pct > 0 && pct < 0.05 ? "<0.1%" : percent(pct)

export function KeysTable({ keys, users, onEditKey }: KeysTableProps) {
  const queryClient = useQueryClient()
  // The row waiting on the revoke dialog. The dialog names the key, so no row
  // has to carry a destructive control of its own.
  const [revokeTarget, setRevokeTarget] = useState<APIKeyResponse | null>(null)
  // Rotation is its own surface because the new secret is shown exactly once.
  const [regenerateTarget, setRegenerateTarget] =
    useState<APIKeyResponse | null>(null)
  const ownerNames = useMemo(
    () => new Map(users.map((user) => [user.id, user.name])),
    [users]
  )
  const ownerOf = (key: APIKeyResponse) =>
    key.user_id === null ? null : (ownerNames.get(key.user_id) ?? "Unknown")

  const toggle = useMutation({
    mutationFn: ({ keyID, enabled }: ToggleInput) =>
      updateAPIKey(keyID, { enabled }),
    // The switch flips in the same frame it is pressed; the request only has to
    // agree with what the operator already sees.
    onMutate: async ({ keyID, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["keys"] })
      const previous = queryClient.getQueryData<KeyListResponse>(
        keyListQuery.queryKey
      )
      if (previous) {
        queryClient.setQueryData<KeyListResponse>(keyListQuery.queryKey, {
          ...previous,
          data: previous.data.map((key) =>
            key.id === keyID ? { ...key, enabled } : key
          ),
        })
      }
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(keyListQuery.queryKey, context.previous)
      }
      toast.error("Could not change key status", {
        description: error instanceof Error ? error.message : undefined,
      })
    },
    // The token quota panel on `/usage` reads the same cache entry, so settling
    // against the server is what keeps the two screens in agreement.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
  })

  const revoke = useMutation({
    mutationFn: (key: APIKeyResponse) => deleteAPIKey(key.id),
    onSuccess: (_result, key) => {
      void queryClient.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Key revoked", {
        description: `${key.name} stops authenticating now.`,
      })
    },
    onError: (error, key) => {
      // A key someone else already deleted is the state the operator asked for,
      // so let the row leave rather than reporting a missing key they wanted gone.
      if (error instanceof APIError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: ["keys"] })
        return
      }
      toast.error(`Could not revoke ${key.name}`, {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  async function confirmRevoke() {
    if (revokeTarget === null) return
    await revoke.mutateAsync(revokeTarget)
  }

  const regenerate = useMutation({
    mutationFn: (key: APIKeyResponse) => regenerateAPIKey(key.id),
    // The list carries only the display prefix, so the row has to be re-read
    // from the server after the rotation.
    onSuccess: (_created, key) => {
      void queryClient.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Key regenerated", {
        description: `${key.name} has a new secret; the previous one stops working now.`,
      })
    },
    onError: (error, key) => {
      toast.error(`Could not regenerate ${key.name}`, {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  const statusSwitch = (row: APIKeyResponse) => (
    <Switch
      checked={row.enabled}
      onCheckedChange={(enabled) => toggle.mutate({ keyID: row.id, enabled })}
      disabled={toggle.isPending}
      aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.name}`}
    />
  )

  // One split control per row: the frequent action is the button, the rest sits
  // behind its arrow, and the irreversible one asks in its own dialog.
  const actions = (row: APIKeyResponse) => (
    <SplitButton
      variant="secondary"
      label="Edit"
      icon={<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />}
      ariaLabel={`Edit ${row.name}`}
      onClick={() => onEditKey(row)}
      actions={[
        {
          label: "Regenerate key",
          icon: <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />,
          onSelect: () => setRegenerateTarget(row),
        },
        {
          label: "Revoke key",
          icon: <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />,
          destructive: true,
          onSelect: () => setRevokeTarget(row),
        },
      ]}
    />
  )

  const identity = (row: APIKeyResponse) => {
    const owner = ownerOf(row)
    return (
      <span className="block min-w-0">
        <span
          className="block truncate text-sm font-medium text-foreground"
          title={row.name}
        >
          {row.name}
        </span>
        {owner && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {owner}
          </span>
        )}
      </span>
    )
  }

  const quota = (row: APIKeyResponse) => {
    if (row.quota_limit === 0) {
      return (
        <span className="block text-xs text-muted-foreground">No budget</span>
      )
    }
    const pct = (row.usage_tokens / row.quota_limit) * 100
    return (
      <span className="flex w-full flex-col items-end gap-1">
        <span className={`text-sm tabular-nums ${quotaText(pct)}`}>
          {quotaPercent(pct)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {COMPACT.format(row.usage_tokens)} of{" "}
          {COMPACT.format(row.quota_limit)}
        </span>
        <ShareBar value={pct} tone={quotaTone(pct)} className="h-[3px]" />
      </span>
    )
  }

  const spend = (row: APIKeyResponse) => {
    const cap = row.credit_limit ?? 0
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="text-sm text-foreground tabular-nums">
          {SPEND.format(row.usage_cost ?? 0)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cap === 0 ? "no cap" : `of ${SPEND.format(cap)}`}
        </span>
      </span>
    )
  }

  // The identity column carries the name at body size and its key at meta size;
  // every figure is one step smaller than the name it belongs to, right-aligned,
  // and two measures (value over its limit) stack in one cell instead of
  // taking a column each. The two harmless actions are ghosts so the one
  // irreversible control is the only thing wearing colour.
  const columns: DataColumn<APIKeyResponse>[] = [
    { key: "name", label: "Key", render: (_value, row) => identity(row) },
    {
      key: "enabled",
      label: "Status",
      width: 76,
      render: (_value, row) => statusSwitch(row),
    },
    {
      key: "quota_limit",
      label: "Token quota",
      width: 190,
      numeric: true,
      render: (_value, row) => quota(row),
    },
    {
      key: "usage_cost",
      label: "Spend",
      width: 116,
      numeric: true,
      render: (_value, row) => spend(row),
    },
    {
      key: "actions",
      label: "Actions",
      // `numeric` is the only lever that right-aligns a header; the cell holds
      // no digits, the alignment is the whole point.
      width: 204,
      numeric: true,
      sortable: false,
      render: (_value, row) => (
        <span className="flex justify-end">{actions(row)}</span>
      ),
    },
  ]

  return (
    <div className="min-w-0">
      <div className="hidden lg:block">
        <SortableDataTable
          rows={keys}
          columns={columns}
          rowKey="id"
          caption="API keys"
        />
      </div>

      {/* Below the laptop tier each key is its own card, two up on a tablet: a
          full-width row of six facts reads as a form, and a table that only fits
          by scrolling sideways is not a phone layout. The switch and the one
          split control share the top-right corner, so no card ends on a stranded
          button; every field the table shows moves here rather than vanishing. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {keys.map((key) => {
          const pct =
            key.quota_limit === 0
              ? null
              : (key.usage_tokens / key.quota_limit) * 100
          return (
            <li
              key={key.id}
              className="rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-medium text-foreground"
                    title={key.name}
                  >
                    {key.name}
                  </p>
                  {ownerOf(key) && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {ownerOf(key)}
                    </p>
                  )}
                </div>
                <div className="shrink-0">{statusSwitch(key)}</div>
              </div>

              <div className="mt-3">
                {pct === null ? (
                  <p className="text-sm text-muted-foreground">
                    No token budget
                  </p>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {COMPACT.format(key.usage_tokens)} of{" "}
                        {COMPACT.format(key.quota_limit)}
                      </span>
                      <span
                        className={`text-sm tabular-nums ${quotaText(pct)}`}
                      >
                        {quotaPercent(pct)}
                      </span>
                    </div>
                    <ShareBar
                      value={pct}
                      tone={quotaTone(pct)}
                      className="mt-2 h-[3px]"
                    />
                  </>
                )}
              </div>

              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {key.rate_limit === 0
                    ? "No rate limit"
                    : `${NUMBER.format(key.rate_limit)} req/min`}
                </span>
                {spend(key)}
              </div>

              <div className="mt-3 flex justify-end">{actions(key)}</div>
            </li>
          )
        })}
      </ul>

      <RegenerateKeyDialog
        open={regenerateTarget !== null}
        onOpenChange={(open) => !open && setRegenerateTarget(null)}
        keyRecord={regenerateTarget}
        onConfirm={async () => {
          if (regenerateTarget === null) throw new Error("No key selected")
          const created = await regenerate.mutateAsync(regenerateTarget)
          return created.key
        }}
      />

      <RevokeKeyDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        keyRecord={revokeTarget}
        onConfirm={confirmRevoke}
      />
    </div>
  )
}
