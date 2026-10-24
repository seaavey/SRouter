import type { UsageStatsReport } from "@/api/types"
import { ActionButton } from "@/components/arc/action-button/action-button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { COMPACT, NUMBER, SPEND } from "./types"

export interface LifetimeLedgerSectionProps {
  usageData?: UsageStatsReport
  isPending: boolean
  isError: boolean
  error: Error | null
  onRetry: () => Promise<void>
}

export function LifetimeLedgerSection({
  usageData,
  isPending,
  isError,
  error,
  onRetry,
}: LifetimeLedgerSectionProps) {
  const totals = usageData?.data.totals

  return (
    <section
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
      aria-label="Lifetime ledger"
    >
      <div className="flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Lifetime ledger
        </h2>
        <span className="text-xs text-muted-foreground">
          Since first initialization
        </span>
      </div>

      {isPending ? (
        <div
          className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-8"
          aria-hidden="true"
        >
          <div>
            <Skeleton className="max-w-[7rem]" lines={1} />
            <Skeleton className="mt-2 max-w-[9rem]" lines={1} />
            <Skeleton className="mt-2 max-w-[5rem]" lines={1} />
          </div>
          <div className="flex flex-col divide-y divide-border/70 sm:border-l sm:border-border/70 sm:pl-8">
            {[0, 1, 2, 3].map((slot) => (
              <div
                key={slot}
                className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <Skeleton className="max-w-[6rem]" lines={1} />
                <div className="flex flex-col items-end gap-1">
                  <Skeleton className="max-w-[4rem]" lines={1} />
                  <Skeleton className="max-w-[5rem]" lines={1} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <div className="pt-4">
          <EmptyState
            title="Could not load lifetime totals"
            description={`The usage stats endpoint did not answer (${error?.message ?? "unknown error"}).`}
            action={
              <ActionButton
                label="Retry"
                pendingLabel="Retrying"
                successLabel="Retried"
                onAction={onRetry}
                onActionError={() =>
                  toast.error("Lifetime totals are still unavailable")
                }
              />
            }
          />
        </div>
      ) : (
        totals && (
          // A ledger, not another stat row: the period cards above already are
          // one, and these figures read as a single running total.
          <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-8">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Estimated spend</p>
              <p className="mt-1 text-2xl font-medium tracking-tight text-foreground tabular-nums">
                {totals.cost.total === null
                  ? "Unpriced"
                  : SPEND.format(totals.cost.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {totals.cost.total === null
                  ? "No catalog rate for these models"
                  : totals.cost.estimated
                    ? "Catalog rate"
                    : "Provider reported"}
              </p>
            </div>

            <dl className="flex min-w-0 flex-col divide-y divide-border/70 sm:border-l sm:border-border/70 sm:pl-8">
              <LedgerRow
                label="Requests"
                value={NUMBER.format(totals.requests.total)}
                detail={`${NUMBER.format(totals.requests.success)} ok · ${NUMBER.format(totals.requests.failed)} err`}
              />
              <LedgerRow
                label="Input tokens"
                value={COMPACT.format(totals.tokens.input)}
                detail="Prompt & cached"
              />
              <LedgerRow
                label="Output tokens"
                value={COMPACT.format(totals.tokens.output)}
                detail={`${NUMBER.format(totals.tokens.reasoning)} reasoning`}
              />
              <LedgerRow
                label="Cached reads"
                value={COMPACT.format(totals.tokens.cache.read)}
                detail={`${NUMBER.format(totals.tokens.cache.write)} writes`}
              />
            </dl>
          </div>
        )
      )}
    </section>
  )
}

function LedgerRow({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">
        <span className="block truncate text-sm font-medium text-foreground">
          {value}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail}
        </span>
      </dd>
    </div>
  )
}
