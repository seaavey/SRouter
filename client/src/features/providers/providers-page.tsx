import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { providersQuery, quotaQuery } from "@/shared/api/queries"
import { PageHeader, Panel } from "@/shared/components/layout"
import { QuotaGauge } from "@/shared/components/quota-gauge"
import { EmptyState, ErrorState, LoadingState } from "@/shared/components/states"
import { ProviderStatusBadge } from "@/shared/components/status"
import { Button } from "@/shared/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"

/**
 * Which provider is broken, and what the connected accounts have left.
 *
 * The list sorts disconnected providers to the top: an operator opens this
 * screen because traffic is failing, so the working entries must not sit above
 * the broken one. Quota gauges render underneath, because a provider with a
 * live connection can still be the reason a request fails.
 */
export function ProvidersPage() {
  const [forceRefresh, setForceRefresh] = useState(false)

  const providers = useQuery(providersQuery)
  const quota = useQuery(quotaQuery(forceRefresh))

  if (providers.isPending) {
    return <LoadingState />
  }

  if (providers.isError) {
    return (
      <ErrorState
        title="Could not load providers"
        error={providers.error}
        onRetry={() => providers.refetch()}
      />
    )
  }

  const all = providers.data.data

  if (all.length === 0) {
    return (
      <EmptyState
        title="No providers configured"
        hint="This build ships no provider definitions. Add one before routing traffic."
      />
    )
  }

  const sorted = [...all].sort((left, right) => {
    const leftBroken = Number(left.status.state !== "connected")
    const rightBroken = Number(right.status.state !== "connected")
    if (leftBroken !== rightBroken) {
      return rightBroken - leftBroken
    }

    return left.name.localeCompare(right.name)
  })

  const disconnected = all.filter((provider) => provider.status.state !== "connected").length

  const accounts = quota.data?.providers ?? []
  const quotaWindows = accounts.flatMap((account) =>
    (account.quotas ?? []).map((window) => ({
      key: `${account.id}:${window.name}`,
      provider: account.provider,
      account: account.account,
      window,
    }))
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Providers"
        subtitle={
          disconnected === 0
            ? `All ${all.length} providers have at least one connection.`
            : `${disconnected} of ${all.length} providers have no connections.`
        }
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead className="text-right">Models</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell className="font-mono text-xs">{provider.id}</TableCell>
                <TableCell>
                  <ProviderStatusBadge
                    state={provider.status.state}
                    connections={provider.status.connected_count}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {provider.protocol}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {provider.models.length}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {provider.status.message}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Panel
        title="Quota"
        description="Remaining allowance per account. The server caches this; refresh asks it to re-read upstream."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={quota.isFetching}
            onClick={() => {
              // The server coalesces concurrent misses, so this only changes
              // the cache key once per click.
              setForceRefresh(true)
              void quota.refetch()
            }}
          >
            {quota.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
        contentClassName="px-6"
      >
        {quota.isPending ? (
          <LoadingState className="h-40 w-full" />
        ) : quota.isError ? (
          <ErrorState
            title="Could not load quota"
            error={quota.error}
            onRetry={() => quota.refetch()}
          />
        ) : quotaWindows.length === 0 ? (
          <EmptyState
            title="No quota reported"
            hint="Quota is only reported by providers that expose it — the OAuth accounts, not the free-tier or API-key ones."
          />
        ) : (
          <div className="flex flex-wrap gap-6">
            {quotaWindows.map((entry) => (
              <QuotaGauge
                key={entry.key}
                label={entry.window.name}
                used={entry.window.used}
                limit={entry.window.limit}
                percentage={entry.window.percentage_value}
                status={entry.window.status}
                resetIn={entry.window.reset_in}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
