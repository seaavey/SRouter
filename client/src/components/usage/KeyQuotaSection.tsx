import { KeyRound, ShieldAlert } from "lucide-react"
import { useMemo } from "react"

import { ActionButton } from "@/components/arc/action-button/action-button"
import { Badge } from "@/components/arc/badge/badge"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { SearchField } from "@/components/arc/search-field/search-field"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { useSearch } from "@/hooks/useSearch"
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
  const {
    query: search,
    filteredItems: filteredKeys,
    fieldProps: searchFieldProps,
  } = useSearch(keyRows, {
    debounceMs: 150,
    keys: ["name", "prefix"],
  })

  const nearCount = useMemo(
    () => keyRows.filter((r) => r.percent !== null && r.percent >= 80).length,
    [keyRows]
  )

  return (
    <section
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
      aria-label="Token quota per API key"
    >
      {/* Responsive toolbar header: stack on mobile, inline on tablet/laptop/desktop */}
      <div className="flex flex-col gap-3 border-b border-border pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound
            size={16}
            className="shrink-0 text-foreground"
            aria-hidden="true"
          />
          <h2 className="text-sm font-medium tracking-tight text-foreground">
            Token quota by key
          </h2>
          <span className="text-xs text-muted-foreground">
            ({filteredKeys.length})
          </span>
          {nearCount > 0 && keyFilter !== "near" && (
            <Badge
              tone="warning"
              size="sm"
              className="inline-flex items-center gap-1"
            >
              <ShieldAlert size={12} aria-hidden="true" />
              {nearCount} near limit
            </Badge>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {keyRows.length > 3 && (
            <div className="w-full sm:w-44">
              <SearchField
                label="Search keys"
                placeholder="Filter name/prefix..."
                {...searchFieldProps}
              />
            </div>
          )}
          <div className="self-start sm:self-auto">
            <SegmentedControl
              options={KEY_FILTER_OPTIONS}
              value={keyFilter}
              onValueChange={(value) => onKeyFilterChange(value as KeyFilter)}
              label="Key filter"
            />
          </div>
        </div>
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
      ) : filteredKeys.length === 0 ? (
        <div className="pt-4">
          <EmptyState
            title={
              search
                ? "No matching keys found"
                : keyFilter === "near"
                  ? "No key is near its quota"
                  : "No API keys yet"
            }
            description={
              search
                ? `No API key matched "${search}". Clear the query to see all keys.`
                : keyFilter === "near"
                  ? "Every metered key is below 80 percent of its token budget. Switch the filter to all keys to see them."
                  : "Create a key on the keys screen and its token consumption appears here after the gateway serves a request with it."
            }
          />
        </div>
      ) : (
        <ul className="animate-in divide-y divide-border duration-300 fade-in-0 motion-reduce:animate-none">
          {filteredKeys.map((row) => {
            const nearQuota = row.percent !== null && row.percent >= 80
            return (
              <li key={row.id} className="px-1 py-3">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-medium text-foreground">
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
                    {nearQuota && (
                      <Badge tone="warning" size="sm">
                        Near quota
                      </Badge>
                    )}
                    {row.percent === null && (
                      <Badge tone="neutral" size="sm">
                        Unlimited
                      </Badge>
                    )}
                  </div>
                  <span className="self-end text-xs font-medium text-foreground tabular-nums sm:self-auto">
                    {row.percent === null ? "No budget" : percent(row.percent)}
                  </span>
                </div>

                {row.percent !== null && (
                  <div className="mt-2">
                    <ShareBar
                      value={row.percent}
                      tone={
                        row.percent >= 100
                          ? "danger"
                          : nearQuota
                            ? "warning"
                            : "neutral"
                      }
                    />
                  </div>
                )}

                <div className="mt-1.5 flex flex-col gap-y-1 text-xs text-muted-foreground tabular-nums sm:flex-row sm:items-center sm:gap-x-4">
                  <span>
                    {row.percent === null
                      ? `${NUMBER.format(row.used)} tokens used, no budget set`
                      : `${NUMBER.format(row.used)} of ${NUMBER.format(row.quota)} tokens`}
                  </span>
                  <span className="hidden sm:inline">·</span>
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
