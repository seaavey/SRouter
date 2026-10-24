import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react"
import type { AnalyticsWindow } from "@/api/logs"
import type { AnalyticsReport } from "@/api/types"
import { ActionButton } from "@/components/arc/action-button/action-button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { MetricCard } from "@/components/arc/metric-card/metric-card"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { COMPACT, NUMBER, percent } from "./types"
import { ShareBar } from "./ShareBar"

export interface PeriodSpendSectionProps {
  range: AnalyticsWindow
  analyticsData?: AnalyticsReport
  isPending: boolean
  isError: boolean
  error: Error | null
  windowSpend: number | null
  lifetimeSpend: number | null
  spendShare: number | null
  windowTotals: {
    prompt: number
    completion: number
    cached: number
    total: number
    cacheRate: number
  }
  onRetry: () => Promise<void>
}

export function PeriodSpendSection({
  range,
  analyticsData,
  isPending,
  isError,
  error,
  windowSpend,
  lifetimeSpend,
  spendShare,
  windowTotals,
  onRetry,
}: PeriodSpendSectionProps) {
  if (isError) {
    return (
      <section
        className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
        aria-label="Period usage unavailable"
      >
        <EmptyState
          title="Could not load this period"
          description={`The analytics endpoint did not answer (${error?.message ?? "no error detail"}). Lifetime totals and key quota below come from different endpoints and may still be current.`}
          action={
            <ActionButton
              label="Retry"
              pendingLabel="Retrying"
              successLabel="Retried"
              onAction={onRetry}
              onActionError={() =>
                toast.error("Usage data is still unavailable")
              }
            />
          }
        />
      </section>
    )
  }

  return (
    <section
      aria-label={`Usage metrics past ${range}`}
      className="flex flex-col gap-3"
    >
      {/* Two up on a phone: MetricCard's container queries drop the padding and
          type as the column narrows, so the narrow register is the card's own.
          Tablet (sm: 640px+): 2 cols. Laptop (lg: 1024px+): 4 cols. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 lg:grid-cols-4">
        {isPending ? (
          <>
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                aria-hidden="true"
                className="rounded-[var(--radius-surface)] border border-border bg-surface p-3 shadow-[var(--shadow-resting)] sm:p-5"
              >
                <Skeleton className="max-w-[7rem]" lines={1} />
                <Skeleton className="mt-3 max-w-[10rem] text-xl" lines={1} />
                <Skeleton className="mt-4 max-w-[12rem]" lines={1} />
              </div>
            ))}
          </>
        ) : (
          <>
            <MetricCard
              label="Period spend"
              value={windowSpend ?? 0}
              prefix="$"
              decimals={2}
              context={
                windowSpend === null
                  ? "Unpriced (no catalog rate)"
                  : spendShare !== null && lifetimeSpend !== null
                    ? `${percent(spendShare)} of $${lifetimeSpend.toFixed(2)} lifetime`
                    : `Estimated cost in past ${range}`
              }
            />

            <MetricCard
              label="Total tokens"
              value={windowTotals.total}
              decimals={0}
              context={
                <>
                  <span className="inline-flex items-center gap-1 align-middle">
                    <ArrowDownToLine size={12} aria-hidden="true" />
                    {COMPACT.format(windowTotals.prompt)}
                    <span className="sr-only">input</span>
                  </span>
                  {" · "}
                  <span className="inline-flex items-center gap-1 align-middle">
                    <ArrowUpFromLine size={12} aria-hidden="true" />
                    {COMPACT.format(windowTotals.completion)}
                    <span className="sr-only">output</span>
                  </span>
                </>
              }
            />

            <MetricCard
              label="Total requests"
              value={analyticsData?.total_requests ?? 0}
              decimals={0}
              context={`Across all models in ${range}`}
            />

            <MetricCard
              label="Prompt cache hit"
              value={windowTotals.cacheRate}
              suffix="%"
              decimals={1}
              context={`${COMPACT.format(windowTotals.cached)} cached tokens read`}
            />
          </>
        )}
      </div>

      {/* The share row and the token counts stack until the laptop tier: side by
          side they leave the bar a few pixels at 768px. */}
      {!isPending && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-surface)] border border-border bg-card p-3.5 shadow-[var(--shadow-resting)] sm:px-4 sm:py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3">
            <span className="shrink-0 text-xs font-medium text-foreground">
              Period share
            </span>
            {spendShare !== null ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {/* No width cap: a capped bar strands the percentage mid-row at
                    tablet, where the token row below already spans the panel. */}
                <ShareBar value={spendShare} className="flex-1" />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {percent(spendShare)}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                No catalog pricing available for period models
              </span>
            )}
          </div>

          {/* Three columns rather than a wrapping flex row: with `justify-between`
              the second line strands one pair at the left edge, and the numbers
              stop lining up. `lg` returns to the content-sized row beside the bar. */}
          <div className="grid shrink-0 grid-cols-3 items-center gap-x-4 gap-y-1 text-xs text-muted-foreground lg:flex lg:flex-wrap">
            <span>
              Input{" "}
              <strong className="font-medium text-foreground tabular-nums">
                {NUMBER.format(windowTotals.prompt)}
              </strong>
            </span>
            <span>
              Output{" "}
              <strong className="font-medium text-foreground tabular-nums">
                {NUMBER.format(windowTotals.completion)}
              </strong>
            </span>
            <span>
              Cached{" "}
              <strong className="font-medium text-foreground tabular-nums">
                {NUMBER.format(windowTotals.cached)}
              </strong>
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
