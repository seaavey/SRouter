import { KeyRound } from "lucide-react"

import { ActionButton } from "@/components/arc/action-button/action-button"
import { Badge } from "@/components/arc/badge/badge"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import {
  KEY_FILTER_OPTIONS,
  type KeyFilter,
  type KeyRow,
  NUMBER,
  percent,
} from "./types"
import { ShareBar } from "./ShareBar"
import { KeyRowPlaceholders } from "./UsagePlaceholders"

export interface KeyQuotaSectionProps {
  keyFilter: KeyFilter
  onKeyFilterChange: (filter: KeyFilter) => void
  isPending: boolean
  isError: boolean
  error: Error | null
  keyRows: KeyRow[]
  onRetry: () => Promise<void>
}

export function KeyQuotaSection({
  keyFilter,
  onKeyFilterChange,
  isPending,
  isError,
  error,
  keyRows,
  onRetry,
}: KeyQuotaSectionProps) {
  return (
    <section
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
      aria-label="Token quota per API key"
    >
      {/* Wraps rather than overflows: at 768px the title row and the filter no
          longer fit on one line. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3.5">
        <div className="flex items-center gap-2">
          <KeyRound
            size={16}
            className="shrink-0 text-foreground"
            aria-hidden="true"
          />
          <h2 className="text-sm font-medium tracking-tight text-foreground">
            Token quota by key
          </h2>
          <span className="text-xs text-muted-foreground">
            ({keyRows.length})
          </span>
        </div>

        <SegmentedControl
          options={KEY_FILTER_OPTIONS}
          value={keyFilter}
          onValueChange={(value) => onKeyFilterChange(value as KeyFilter)}
          label="Key filter"
          className="w-full sm:w-auto"
        />
      </div>

      {isPending ? (
        <div className="mt-1">
          <KeyRowPlaceholders rows={4} />
        </div>
      ) : isError ? (
        <div className="pt-4">
          <EmptyState
            title="Could not load key quota"
            description={`The key list did not answer (${error?.message ?? "no error detail"}). The keys screen owns mutations; this panel only reads what each key has consumed.`}
            action={
              <ActionButton
                label="Retry"
                pendingLabel="Retrying"
                successLabel="Retried"
                onAction={onRetry}
                onActionError={() =>
                  toast.error("Key quota is still unavailable")
                }
              />
            }
          />
        </div>
      ) : keyRows.length === 0 ? (
        <div className="pt-4">
          <EmptyState
            title={
              keyFilter === "near"
                ? "No key is near its quota"
                : "No API keys yet"
            }
            description={
              keyFilter === "near"
                ? "Every metered key is below 80 percent of its token budget. Switch the filter to all keys to see them."
                : "Create a key on the keys screen and its token consumption appears here after the gateway serves a request with it."
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {keyRows.map((row) => {
            const nearQuota = row.percent !== null && row.percent >= 80
            const overQuota = row.percent !== null && row.percent >= 100
            return (
              <li key={row.id} className="px-1 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {row.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.prefix}
                    </span>
                    {!row.enabled && (
                      <Badge tone="danger" size="sm">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  {/* The figure carries the state on its own: the tone only
                      reinforces a number that already reads as near or over. */}
                  <span
                    className={`shrink-0 text-sm font-medium tabular-nums ${
                      overQuota
                        ? "text-danger"
                        : nearQuota
                          ? "text-warning"
                          : "text-foreground"
                    }`}
                  >
                    {row.percent === null ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        Unlimited
                      </span>
                    ) : (
                      percent(row.percent)
                    )}
                  </span>
                </div>

                {row.percent !== null && (
                  <div className="mt-2">
                    <ShareBar
                      value={row.percent}
                      tone={
                        overQuota ? "danger" : nearQuota ? "warning" : "neutral"
                      }
                    />
                  </div>
                )}

                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {row.percent === null
                      ? `${NUMBER.format(row.used)} tokens used, no budget set`
                      : `${NUMBER.format(row.used)} of ${NUMBER.format(row.quota)} tokens`}
                  </span>
                  <span>
                    {row.rateLimit === 0
                      ? "No rate limit"
                      : `${NUMBER.format(row.rateLimit)} req/min`}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
