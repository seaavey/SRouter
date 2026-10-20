import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Pencil, Plus, Users } from "lucide-react"
import { useState } from "react"

import type { UserListResponse, UserResponse } from "@/api/types"
import { updateUser, usersQuery } from "@/api/users"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import { Switch } from "@/components/arc/switch/switch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { SectionHeader } from "@/components/layout/section-header"

import CreateUserDialog from "./CreateUserDialog"
import RenameUserDialog from "./RenameUserDialog"
import TokenDialog from "./TokenDialog"

type ToggleInput = { userID: string; enabled: boolean }

export default function UsersView() {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(usersQuery)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameUser, setRenameUser] = useState<UserResponse | null>(null)
  const [tokenUser, setTokenUser] = useState<UserResponse | null>(null)

  const users = data?.data ?? []

  const toggle = useMutation({
    mutationFn: ({ userID, enabled }: ToggleInput) =>
      updateUser(userID, { enabled }),
    // The switch flips in the same frame it is pressed; the request only has to
    // agree with what the operator already sees.
    onMutate: async ({ userID, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["users"] })
      const previous = queryClient.getQueryData<UserListResponse>(
        usersQuery.queryKey
      )
      if (previous) {
        queryClient.setQueryData<UserListResponse>(usersQuery.queryKey, {
          ...previous,
          data: previous.data.map((user) =>
            user.id === userID ? { ...user, enabled } : user
          ),
        })
      }
      return { previous }
    },
    onError: (mutationError, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(usersQuery.queryKey, context.previous)
      }
      toast.error("Could not change account status", {
        description:
          mutationError instanceof Error ? mutationError.message : undefined,
      })
    },
    // Disabling an account suspends every key it owns, so the keys screen has
    // stale rows in the same cache until its list is refetched too.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      void queryClient.invalidateQueries({ queryKey: ["keys"] })
    },
  })

  async function retry() {
    const result = await refetch()
    if (result.error) throw result.error
  }

  const columns: DataColumn<UserResponse>[] = [
    {
      key: "name",
      label: "Name",
      width: 180,
      render: (_value, row) => (
        <span className="block truncate text-xs font-medium text-foreground">
          {row.name}
        </span>
      ),
    },
    {
      key: "token_prefix",
      label: "Token prefix",
      width: 120,
      render: (_value, row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.token_prefix}
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
              toggle.mutate({ userID: row.id, enabled })
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
      width: 90,
      sortable: false,
      render: (_value, row) => (
        <span className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Rename ${row.name}`}
            onClick={() => setRenameUser(row)}
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`New login token for ${row.name}`}
            onClick={() => setTokenUser(row)}
          >
            <KeyRound size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Users"
        description="Create the customer accounts that sign in to the console. Each one signs in with a login token and owns its own API keys."
        badge="Access control"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Create user
          </Button>
        }
      />

      {isPending && <Skeleton label="Loading users" lines={5} />}

      {isError && (
        <Alert tone="danger" title="Could not load users">
          <span className="flex flex-col items-start gap-3">
            <span className="break-words">
              {error instanceof Error
                ? error.message
                : "The users endpoint could not be reached."}
            </span>
            <ActionButton
              label="Retry"
              pendingLabel="Retrying"
              successLabel="Loaded"
              onAction={retry}
              className="!border-border !bg-surface !text-foreground"
            />
          </span>
        </Alert>
      )}

      {!isPending && !isError && users.length === 0 && (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title="No customer accounts"
          description="Create a user so a customer can sign in to the console and read their own keys and request logs."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Create user
            </Button>
          }
        />
      )}

      {!isPending && !isError && users.length > 0 && (
        <SortableDataTable
          rows={users}
          columns={columns}
          rowKey="id"
          caption="Users"
          defaultSort={{ key: "created_at", direction: "desc" }}
        />
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RenameUserDialog
        open={renameUser !== null}
        onOpenChange={(open) => !open && setRenameUser(null)}
        userRecord={renameUser}
      />
      <TokenDialog
        open={tokenUser !== null}
        onOpenChange={(open) => !open && setTokenUser(null)}
        userRecord={tokenUser}
      />
    </div>
  )
}
