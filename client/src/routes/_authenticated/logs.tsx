import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"

import { logsQuery, type LogsFilter } from "@/api/dashboard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const PAGE_SIZE = 50

export const Route = createFileRoute("/_authenticated/logs")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Math.max(1, Number(search.page) || 1),
    filter: (["all", "success", "error"] as const).includes(search.filter as LogsFilter)
      ? (search.filter as LogsFilter)
      : ("all" as LogsFilter),
  }),
  component: Logs,
})

/**
 * A status code reads as success, a client mistake, or a server fault. The
 * three are visually distinct because the operator scanning this table is
 * looking for the third one.
 */
function StatusBadge({ code }: { code: number }) {
  const variant =
    code >= 500 ? "destructive" : code >= 400 ? "outline" : "secondary"

  return <Badge variant={variant}>{code}</Badge>
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms} ms`
  }

  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function formatTimestamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function Logs() {
  const navigate = useNavigate()
  const { page, filter } = useSearch({ from: "/_authenticated/logs" })

  const logs = useQuery({
    ...logsQuery({ page, limit: PAGE_SIZE, filter }),
    // Paging must not blank the table: the previous page stays visible while
    // the next one loads.
    placeholderData: keepPreviousData,
  })

  const pagination = logs.data?.pagination
  const totalPages = pagination?.total_pages ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-medium">Request logs</h1>
          <p className="text-muted-foreground text-xs">
            {pagination
              ? `${pagination.total.toLocaleString()} recorded ${
                  pagination.total === 1 ? "request" : "requests"
                }`
              : "Newest first"}
          </p>
        </div>

        <ToggleGroup
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0] as LogsFilter | undefined
            if (!next) return
            // A filter change resets the page: staying on page 4 of a
            // different result set usually lands on an empty page.
            navigate({ to: "/logs", search: { filter: next, page: 1 } })
          }}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="success">Succeeded</ToggleGroupItem>
          <ToggleGroupItem value="error">Failed</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {logs.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load requests</AlertTitle>
          <AlertDescription>{logs.error.message}</AlertDescription>
        </Alert>
      ) : logs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : logs.data.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {filter === "all" ? "No requests recorded" : `No ${filter} requests`}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "all"
                ? "Traffic through this gateway appears here as it happens."
                : "Switch back to All to see every recorded request."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.data.data.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <StatusBadge code={log.status_code} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {log.resolved_model ?? log.model ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {log.provider ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(log.latency_ms)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {log.tokens.total === null || log.tokens.total === undefined
                      ? "—"
                      : log.tokens.total.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                    {formatTimestamp(log.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground text-xs tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => navigate({ to: "/logs", search: { filter, page: page - 1 } })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => navigate({ to: "/logs", search: { filter, page: page + 1 } })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
