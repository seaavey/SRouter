import { Link } from "@tanstack/react-router"
import { ChevronDown, Cpu } from "lucide-react"

import type { UsageByModel } from "@/api/types"
import { Badge } from "@/components/arc/badge/badge"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import {
  COMPACT,
  METRIC_OPTIONS,
  type ModelMetric,
  type ModelRow,
  MONEY,
  NUMBER,
  percent,
} from "./types"
import { ShareBar } from "./ShareBar"
import { ModelRowPlaceholders } from "./UsagePlaceholders"

export interface ModelUsageSectionProps {
  range: string
  metric: ModelMetric
  onMetricChange: (metric: ModelMetric) => void
  isPending: boolean
  modelRows: ModelRow[]
  expandedModel: string | null
  onToggleExpanded: (modelID: string) => void
  lifetimeModels: Map<string, UsageByModel>
}

export function ModelUsageSection({
  range,
  metric,
  onMetricChange,
  isPending,
  modelRows,
  expandedModel,
  onToggleExpanded,
  lifetimeModels,
}: ModelUsageSectionProps) {
  return (
    <section
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
      aria-label={`Models routed past ${range}`}
    >
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Cpu
            size={16}
            className="shrink-0 text-foreground"
            aria-hidden="true"
          />
          <h2 className="text-sm font-medium tracking-tight text-foreground">
            Models in this period
          </h2>
          <span className="text-xs text-muted-foreground">
            ({modelRows.length})
          </span>
        </div>

        <SegmentedControl
          options={METRIC_OPTIONS}
          value={metric}
          onValueChange={(value) => onMetricChange(value as ModelMetric)}
          label="Breakdown metric"
        />
      </div>

      {isPending ? (
        <div className="mt-4">
          <ModelRowPlaceholders rows={5} />
        </div>
      ) : modelRows.length === 0 ? (
        <div className="pt-4">
          <EmptyState
            title="No requests in this period"
            description="Per-model usage appears here once the gateway routes a completion. Pick a wider period above to look further back."
          />
        </div>
      ) : (
        <ul className="animate-in divide-y divide-border duration-300 fade-in-0 motion-reduce:animate-none">
          {modelRows.map((row, index) => {
            const expanded = expandedModel === row.id
            const detailID = `model-detail-${index}`
            const lifetime = lifetimeModels.get(row.model)

            return (
              <li key={row.id}>
                <div className="group relative -mx-2">
                  {/* Row content is inert so the stretched button owns the click; the provider link opts back in. */}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={expanded ? detailID : undefined}
                    aria-label={`${expanded ? "Collapse" : "Expand"} details for ${row.model}`}
                    onClick={() => onToggleExpanded(row.id)}
                    className="absolute inset-0 z-0 h-full w-full cursor-pointer rounded-lg focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none"
                  />
                  <div className="pointer-events-none relative z-10 flex flex-col items-stretch gap-1.5 rounded-lg px-2 py-3 transition-colors group-hover:bg-surface-muted/40">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <ChevronDown
                          size={14}
                          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                            expanded ? "rotate-180 text-foreground" : ""
                          }`}
                          aria-hidden="true"
                        />
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs font-medium text-foreground">
                            {row.model}
                          </span>
                          {row.provider !== "default" ? (
                            <Link
                              to="/providers/$providerId"
                              params={{ providerId: row.provider }}
                              className="group/badge pointer-events-auto relative z-20 inline-flex shrink-0 rounded-[var(--radius-pill)] transition-transform duration-150 ease-out focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none active:scale-95"
                            >
                              <Badge
                                tone="neutral"
                                size="sm"
                                className="cursor-pointer transition-colors group-hover/badge:border-foreground/30 group-hover/badge:bg-surface-muted"
                              >
                                {row.provider}
                              </Badge>
                            </Link>
                          ) : (
                            <Badge
                              tone="neutral"
                              size="sm"
                              className="shrink-0"
                            >
                              {row.provider}
                            </Badge>
                          )}
                        </div>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-foreground tabular-nums">
                        {metric === "cost"
                          ? row.cost === null
                            ? "Unpriced"
                            : MONEY.format(row.cost)
                          : metric === "tokens"
                            ? `${COMPACT.format(row.tokens)} tokens`
                            : `${NUMBER.format(row.requests)} reqs`}
                      </span>
                    </div>

                    {metric === "cost" && row.cost === null ? (
                      <p className="pl-5 text-xs text-muted-foreground">
                        No catalog rate for this id, so it is left out of the
                        spend figure above.
                      </p>
                    ) : (
                      <div className="flex items-center gap-3 pl-5">
                        <ShareBar value={row.share} className="flex-1" />
                        <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          {percent(row.share)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div
                    id={detailID}
                    className="my-1 grid grid-cols-1 gap-4 rounded-lg bg-surface-muted/30 p-3.5 text-xs sm:grid-cols-2"
                  >
                    <div>
                      <h3 className="font-medium text-foreground">
                        This period ({range})
                      </h3>
                      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                        <div>
                          <dt className="text-muted-foreground">Requests</dt>
                          <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                            {NUMBER.format(row.requests)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Tokens</dt>
                          <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                            {NUMBER.format(row.tokens)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Cache hit</dt>
                          <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                            {row.promptTokens > 0
                              ? percent(
                                  (row.cachedTokens / row.promptTokens) * 100
                                )
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Spend</dt>
                          <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                            {row.cost === null
                              ? "Unpriced"
                              : MONEY.format(row.cost)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="border-t border-border pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                      <h3 className="font-medium text-foreground">
                        Lifetime for this id
                      </h3>
                      {lifetime ? (
                        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                          <div>
                            <dt className="text-muted-foreground">Requests</dt>
                            <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                              {NUMBER.format(lifetime.total_requests)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Tokens</dt>
                            <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                              {NUMBER.format(
                                lifetime.total_input_tokens +
                                  lifetime.total_output_tokens
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Spend</dt>
                            <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                              {lifetime.est_cost === null
                                ? "Unpriced"
                                : MONEY.format(lifetime.est_cost)}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-2 text-muted-foreground">
                          The lifetime ledger has no record for this id.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {modelRows.length > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-pretty text-muted-foreground">
          Spend is the estimated cost summed from the request log. A model with
          no catalog rate logs $0.00, so read it against its token count instead
          of assuming the tokens were free.
        </p>
      )}
    </section>
  )
}
