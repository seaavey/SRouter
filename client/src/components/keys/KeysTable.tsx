import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Coins, Pencil } from "lucide-react"
import { useState } from "react"

import { APIError } from "@/api/client"
import { deleteAPIKey, keyListQuery, updateAPIKey } from "@/api/keys"
import type { APIKeyResponse, KeyListResponse, UserResponse } from "@/api/types"
import { Button } from "@/components/arc/button/button"
import { HoldToConfirm } from "@/components/arc/hold-to-confirm/hold-to-confirm"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import { Switch } from "@/components/arc/switch/switch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { MONEY, NUMBER, percent } from "@/components/usage/types"

type KeysTableProps = {
  keys: APIKeyResponse[]
  users: UserResponse[]
  onEditKey: (key: APIKeyResponse) => void
  onAddCredit: (key: APIKeyResponse) => void
}

type ToggleInput = { keyID: string; enabled: boolean }

export function KeysTable({
  keys,
  users,
  onEditKey,
  onAddCredit,
}: KeysTableProps) {
  const queryClient = useQueryClient()
  // The row whose hold completed. It drives `confirmed` on that one button so a
  // failed revoke rewinds the hold instead of leaving the row stuck on "Revoked".
  const [revokingID, setRevokingID] = useState<string | null>(null)

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
      setRevokingID(null)
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

  const columns: DataColumn<APIKeyResponse>[] = [
    {
      key: "name",
      label: "Name",
      width: 160,
      render: (_value, row) => (
        <span className="block truncate text-xs font-medium text-foreground">
          {row.name}
        </span>
      ),
    },
    {
      key: "key_prefix",
      label: "Prefix",
      width: 90,
      render: (_value, row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.key_prefix}
        </span>
      ),
    },
    {
      key: "user_id",
      label: "Owner",
      width: 130,
      // Sorting on the account UUID would order the column by something the
      // operator cannot see, so the name is display-only.
      sortable: false,
      render: (_value, row) => (
        <span className="block truncate text-xs text-muted-foreground">
          {row.user_id === null
            ? "Unassigned"
            : (users.find((user) => user.id === row.user_id)?.name ??
              "Unknown")}
        </span>
      ),
    },
    {
      key: "enabled",
      label: "Status",
      width: 130,
      render: (_value, row) => (
        <span className="flex items-center gap-2">
          <Switch
            checked={row.enabled}
            onCheckedChange={(enabled) =>
              toggle.mutate({ keyID: row.id, enabled })
            }
            disabled={toggle.isPending}
            aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.name}`}
          />
          <span className="text-xs text-muted-foreground">
            {row.enabled ? "Enabled" : "Disabled"}
          </span>
        </span>
      ),
    },
    {
      key: "rate_limit",
      label: "Rate limit",
      width: 120,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-foreground tabular-nums">
          {row.rate_limit === 0
            ? "Unlimited"
            : `${NUMBER.format(row.rate_limit)} req/m`}
        </span>
      ),
    },
    {
      key: "quota_limit",
      label: "Token quota",
      width: 180,
      numeric: true,
      render: (_value, row) => (
        <span className="flex flex-col items-end gap-0.5">
          {row.quota_limit === 0 ? (
            <span className="text-xs text-muted-foreground">No budget</span>
          ) : (
            <>
              <span className="text-xs text-foreground tabular-nums">
                {NUMBER.format(row.usage_tokens)} /{" "}
                {NUMBER.format(row.quota_limit)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {percent((row.usage_tokens / row.quota_limit) * 100)}
              </span>
            </>
          )}
        </span>
      ),
    },
    {
      key: "usage_cost",
      label: "Spend",
      width: 140,
      numeric: true,
      render: (_value, row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-xs text-foreground tabular-nums">
            {MONEY.format(row.usage_cost ?? 0)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {(row.credit_limit ?? 0) === 0
              ? "No cap"
              : `of ${MONEY.format(row.credit_limit ?? 0)}`}
          </span>
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      width: 110,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: 240,
      sortable: false,
      render: (_value, row) => (
        <span className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Edit ${row.name}`}
            onClick={() => onEditKey(row)}
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Add credit to ${row.name}`}
            onClick={() => onAddCredit(row)}
          >
            <Coins size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
          <HoldToConfirm
            size="sm"
            tone="danger"
            label="Hold to revoke"
            confirmedLabel="Revoked"
            confirmed={revokingID === row.id}
            onConfirm={() => {
              setRevokingID(row.id)
              revoke.mutate(row)
            }}
          />
        </span>
      ),
    },
  ]

  return (
    <SortableDataTable
      rows={keys}
      columns={columns}
      rowKey="id"
      caption="API keys"
      defaultSort={{ key: "created_at", direction: "desc" }}
    />
  )
}
