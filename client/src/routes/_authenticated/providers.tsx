import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { providersQuery } from "@/api/dashboard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_authenticated/providers")({
  component: Providers,
})

/**
 * `connected` and `no_connections` are the only two states the server reports,
 * and they decide whether the operator can send traffic through the provider.
 * `no_connections` is the loud one: it is the reason a request would fail.
 */
function StatusBadge({ state, count }: { state: string; count: number }) {
  if (state === "connected") {
    return (
      <Badge variant="secondary">
        Connected
        {count > 1 ? ` · ${count}` : ""}
      </Badge>
    )
  }

  return <Badge variant="destructive">No connections</Badge>
}

function Providers() {
  const providers = useQuery(providersQuery)

  if (providers.isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (providers.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load providers</AlertTitle>
        <AlertDescription>{providers.error.message}</AlertDescription>
      </Alert>
    )
  }

  const all = providers.data.data

  if (all.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No providers configured</EmptyTitle>
          <EmptyDescription>
            This build ships no provider definitions. Add one before routing traffic.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // The broken ones first: an operator opens this screen to find what is not
  // working, so the working entries should not sit above it.
  const sorted = [...all].sort((left, right) => {
    const broken = Number(left.status.state !== "connected") - Number(right.status.state !== "connected")
    if (broken !== 0) return broken

    return left.name.localeCompare(right.name)
  })

  const disconnected = all.filter((provider) => provider.status.state !== "connected").length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-sm font-medium">Providers</h1>
        <p className="text-muted-foreground text-xs">
          {disconnected === 0
            ? `All ${all.length} providers have at least one connection.`
            : `${disconnected} of ${all.length} providers have no connections.`}
        </p>
      </div>

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
                <TableCell>
                  <span className="font-mono text-xs">{provider.id}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    state={provider.status.state}
                    count={provider.status.connected_count}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {provider.protocol}
                </TableCell>
                <TableCell className="text-right tabular-nums">
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
    </div>
  )
}
