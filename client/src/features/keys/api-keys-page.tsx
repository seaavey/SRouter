import { useQuery } from "@tanstack/react-query"

import { apiKeysQuery } from "@/shared/api/queries"
import { PageHeader } from "@/shared/components/layout"
import { EmptyState, ErrorState, LoadingState } from "@/shared/components/states"
import { EnabledBadge } from "@/shared/components/status"
import { numericCell } from "@/shared/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"
import { count } from "@/shared/lib/format"

/**
 * Who has access, and what they have spent.
 *
 * The full secret is never in this list — the server stores only a prefix — so
 * the table shows the prefix and the operator goes to the create flow when they
 * need a new one.
 */
export function APIKeysPage() {
  const keys = useQuery(apiKeysQuery)

  if (keys.isPending) {
    return <LoadingState />
  }

  if (keys.isError) {
    return (
      <ErrorState
        title="Could not load API keys"
        error={keys.error}
        onRetry={() => keys.refetch()}
      />
    )
  }

  const all = keys.data.data

  if (all.length === 0) {
    return (
      <EmptyState
        title="No API keys"
        hint="With no keys this gateway accepts loopback traffic only. Create one before exposing it to another machine."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="API keys"
        subtitle={`${count(all.length)} issued. The full secret is shown once, when the key is created.`}
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>State</TableHead>
              <TableHead className={numericCell}>Tokens used</TableHead>
              <TableHead className={numericCell}>Quota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {all.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {key.key_prefix}…
                </TableCell>
                <TableCell>
                  <EnabledBadge enabled={key.enabled} />
                </TableCell>
                <TableCell className={numericCell}>{count(key.usage_tokens)}</TableCell>
                <TableCell className={numericCell}>
                  {key.quota_limit > 0 ? count(key.quota_limit) : "Unlimited"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
