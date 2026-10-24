import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Database,
} from "lucide-react"

import type { Pagination, RequestLog } from "@/api/types"
import { ActionButton } from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { MetricCard } from "@/components/arc/metric-card/metric-card"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { COMPACT } from "@/components/usage/types"
import { LogDetailSheet } from "./LogDetailSheet"
import { LogTable } from "./LogTable"
import { LogRowPlaceholders } from "./LogPlaceholders"
import { NUMBER, PAGE_SIZE_OPTIONS } from "./types"

export interface LogViewerSectionProps {
  logs: RequestLog[]
  pagination: Pagination | null
  page: number
  onPageChange: (newPage: number) => void
  limit: number
  onLimitChange: (limit: number) => void
  summary: {
    requests: { total: number; success: number; failed: number }
    tokens: {
      input: number
      output: number
      cache_read: number
      cache_write: number
      total: number
    }
    cost: number | null
  } | null
  hasFilters: boolean
  isPending: boolean
  isError: boolean
  error: Error | null
  selectedLog: RequestLog | null
  onSelectLog: (log: RequestLog | null) => void
  onRefresh: () => Promise<void>
}

const FRAME =
  "min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"

export function LogViewerSection({
  logs,
  pagination,
  page,
  onPageChange,
  limit,
  onLimitChange,
  summary,
  hasFilters,
  isPending,
  isError,
  error,
  selectedLog,
  onSelectLog,
  onRefresh,
}: LogViewerSectionProps) {
  const totalPages = pagination?.total_pages ?? 1
  const totalCount = pagination?.total ?? logs.length

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:gap-3.5 lg:grid-cols-3">
          <MetricCard
            label="Requests"
            value={summary.requests.total}
            decimals={0}
            context={`${NUMBER.format(summary.requests.success)} ok · ${NUMBER.format(summary.requests.failed)} failed`}
          />
          <MetricCard
            label="Total tokens"
            value={summary.tokens.total}
            decimals={0}
            context={
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="inline-flex items-center gap-1 align-middle">
                  <ArrowDownToLine size={12} aria-hidden="true" />
                  {COMPACT.format(summary.tokens.input)}
                  <span className="sr-only">input tokens</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 align-middle">
                  <ArrowUpFromLine size={12} aria-hidden="true" />
                  {COMPACT.format(summary.tokens.output)}
                  <span className="sr-only">output tokens</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 align-middle">
                  <Database size={12} aria-hidden="true" />
                  {COMPACT.format(summary.tokens.cache_read)}
                  <span className="sr-only">cached tokens read</span>
                </span>
              </span>
            }
          />
          <div className="col-span-2 lg:col-span-1">
            <MetricCard
              label="Estimated spend"
              value={summary.cost ?? 0}
              prefix="$"
              decimals={2}
              context="From the catalog rate"
            />
          </div>
        </div>
      )}

      {isPending ? (
        <LogRowPlaceholders rows={8} />
      ) : isError ? (
        <section className={FRAME} aria-label="Request logs unavailable">
          <EmptyState
            title="Could not load logs"
            description={`The logs endpoint did not answer (${error?.message ?? "unknown error"}).`}
            action={
              <ActionButton
                label="Retry"
                pendingLabel="Retrying"
                successLabel="Retried"
                onAction={onRefresh}
                onActionError={() => toast.error("Logs are still unavailable")}
              />
            }
          />
        </section>
      ) : logs.length === 0 ? (
        <section className={FRAME} aria-label="No request logs">
          <EmptyState
            title={
              hasFilters
                ? "No logs match these filters"
                : "No logs recorded yet"
            }
            description={
              hasFilters
                ? "Widen the time range, pick another key, or switch the status filter."
                : "Proxied inference requests will appear here once the gateway serves traffic."
            }
          />
        </section>
      ) : (
        <LogTable logs={logs} onSelectLog={onSelectLog} />
      )}

      {!isPending && !isError && logs.length > 0 && (
        <div className="flex flex-col gap-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {NUMBER.format(totalCount)} logs
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </span>

          <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
            <SegmentedControl
              options={PAGE_SIZE_OPTIONS}
              value={String(limit)}
              onValueChange={(value) => onLimitChange(Number(value))}
              label="Rows per page"
            />
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className="gap-1"
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                  className="gap-1"
                >
                  Next
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <LogDetailSheet log={selectedLog} onClose={() => onSelectLog(null)} />
    </div>
  )
}
