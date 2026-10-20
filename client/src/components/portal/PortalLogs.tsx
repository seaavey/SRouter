import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Terminal } from "lucide-react"
import { useState } from "react"

import { portalLogsQuery } from "@/api/portal"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import {
  formatCostUSD,
  formatTime,
  NUMBER,
  STATUS_FILTER_OPTIONS,
  statusTone,
  type LogStatusFilter,
} from "@/components/logs/types"

const PAGE_SIZE = 50

export default function PortalLogs() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("all")

  const status =
    statusFilter === "all"
      ? undefined
      : statusFilter === "failed"
        ? "error"
        : "success"
  const query = useQuery(portalLogsQuery(page, PAGE_SIZE, status))
  const logs = query.data?.data ?? []
  const pagination = query.data?.pagination ?? null

  async function retry() {
    const result = await query.refetch()
    if (result.isError) throw result.error
  }

  function changeFilter(next: LogStatusFilter) {
    setStatusFilter(next)
    setPage(1)
  }

  return (
    <section
      aria-labelledby="portal-logs-heading"
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Terminal
            size={15}
            className="shrink-0 text-foreground"
            aria-hidden="true"
          />
          <h2
            id="portal-logs-heading"
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Request logs
          </h2>
          {pagination && (
            <span className="text-xs text-muted-foreground">
              ({NUMBER.format(pagination.total)})
            </span>
          )}
        </div>

        <SegmentedControl
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onValueChange={(value) => changeFilter(value as LogStatusFilter)}
          label="Filter status"
        />
      </div>

      {query.isPending ? (
        <div className="pt-2">
          <Skeleton label="Loading request logs" lines={6} />
        </div>
      ) : query.isError ? (
        <div className="pt-4">
          <Alert tone="danger" title="Could not load request logs">
            <span className="flex flex-col items-start gap-3">
              <span className="break-words">
                {query.error instanceof Error
                  ? query.error.message
                  : "The portal logs endpoint could not be reached."}
              </span>
              <ActionButton
                label="Retry"
                pendingLabel="Retrying"
                successLabel="Loaded"
                onAction={retry}
              />
            </span>
          </Alert>
        </div>
      ) : logs.length === 0 ? (
        <div className="pt-4">
          <EmptyState
            title={
              statusFilter === "all"
                ? "No requests recorded yet"
                : "No requests match this filter"
            }
            description={
              statusFilter === "all"
                ? "Requests made with this account's keys will appear here."
                : "Try another status to see this account's requests."
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto pt-1">
          <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
            <caption className="sr-only">Request logs for your account</caption>
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Time
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Request
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Model
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Tokens
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatTime(log.created_at)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {log.method}
                      </span>
                      <span className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">
                        {log.path}
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-foreground">
                    {log.resolved_model ?? log.model ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge
                      tone={statusTone(log.status_code)}
                      size="sm"
                      className="font-mono"
                    >
                      {log.status_code}
                    </Badge>
                    {log.error_code && (
                      <span className="mt-0.5 block font-mono text-danger">
                        {log.error_code}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {NUMBER.format(log.tokens.total ?? 0)}
                  </td>
                  <td className="py-2.5 text-right text-foreground tabular-nums">
                    {formatCostUSD(log.costs?.total) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total_pages > 1 && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {page} of {pagination.total_pages} (
            {NUMBER.format(pagination.total)} logs total)
          </span>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage(page - 1)}
              className="gap-1"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pagination.total_pages || query.isFetching}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              Next
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
