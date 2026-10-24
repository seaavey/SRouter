import { useQuery } from "@tanstack/react-query"
import { KeyRound, Plus } from "lucide-react"
import { useState } from "react"

import { keyListQuery } from "@/api/keys"
import type { APIKeyResponse } from "@/api/types"
import { usersQuery } from "@/api/users"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { SectionHeader } from "@/components/layout/section-header"

import { CreateKeyDialog } from "./CreateKeyDialog"
import { EditKeyDialog } from "./EditKeyDialog"
import { KeysPlaceholders } from "./KeysPlaceholders"
import { KeysTable } from "./KeysTable"

export function KeysView() {
  const { data, isPending, isError, error, refetch } = useQuery(keyListQuery)
  const { data: userList } = useQuery(usersQuery)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<APIKeyResponse | null>(null)

  const keys = data?.data ?? []
  const users = userList?.data ?? []

  async function retry() {
    const result = await refetch()
    if (result.error) throw result.error
  }

  return (
    // The two type steps this screen uses are fluid: 12/11px on a phone, the
    // house 14/12 from the laptop tier up. Both the Tailwind utilities and the
    // Arc modules read `--text-sm`/`--text-xs`, so overriding the pair here
    // scales the table, the cards and the controls together.
    <div className="flex flex-col gap-6 [--text-sm--line-height:1.4] [--text-sm:clamp(0.75rem,0.7083rem_+_0.2083vw,0.875rem)] [--text-xs--line-height:1.45] [--text-xs:clamp(0.6875rem,0.6667rem_+_0.1042vw,0.75rem)]">
      <SectionHeader
        title="API keys"
        description="Issue, rotate, and restrict client authentication keys with rate, token, and spend limits."
        badge="Access control"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Create API key
          </Button>
        }
      />

      {isPending && (
        <>
          <span role="status" className="sr-only">
            Loading keys
          </span>
          <KeysPlaceholders />
        </>
      )}

      {isError && (
        <Alert tone="danger" title="Could not load keys">
          <span className="flex flex-col items-start gap-3">
            <span className="break-words">
              {error instanceof Error
                ? error.message
                : "The keys endpoint could not be reached."}
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

      {!isPending && !isError && keys.length === 0 && (
        <EmptyState
          icon={<KeyRound size={28} aria-hidden="true" />}
          title="No API keys issued"
          description="Create a key to authenticate OpenAI- and Anthropic-compatible requests against this gateway."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Create API key
            </Button>
          }
        />
      )}

      {!isPending && !isError && keys.length > 0 && (
        <KeysTable
          keys={keys}
          users={users}
          onEditKey={(key) => setEditingKey(key)}
        />
      )}

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditKeyDialog
        open={editingKey !== null}
        onOpenChange={(open) => !open && setEditingKey(null)}
        keyRecord={editingKey}
      />
    </div>
  )
}
