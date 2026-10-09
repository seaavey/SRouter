import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import {
  analyticsQuery,
  type AnalyticsWindow,
  usageStatsQuery,
} from "@/shared/api/queries"
import type { AnalyticsReport } from "@/shared/api/types"
import { MetricCard, PageHeader, Panel } from "@/shared/components/layout"
import { EmptyState, ErrorState, LoadingState } from "@/shared/components/states"
import { numericCell } from "@/shared/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group"
import { compactCount, cost, count, duration, modelName, rate } from "@/shared/lib/format"

import { TrafficChart } from "./traffic-chart"

const WINDOWS: { value: AnalyticsWindow; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
]

/**
 * The screen an operator opens first: what is happening right now, and what
 * this instance has cost in total. The window controls the traffic section; the
 * lifetime totals sit below it because they answer a different question.
 */
export function DashboardPage() {
  const [window, setWindow] = useState<AnalyticsWindow>("24h")

  const analytics = useQuery(analyticsQuery(window))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        subtitle="Traffic over the selected window, and lifetime totals."
        actions={
          <ToggleGroup
            value={[window]}
            onValueChange={(value) => {
              const next = value[0] as AnalyticsWindow | undefined
              if (next) setWindow(next)
            }}
          >
            {WINDOWS.map((entry) => (
              <ToggleGroupItem key={entry.value} value={entry.value}>
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      {analytics.isPending ? (
        <LoadingState />
      ) : analytics.isError ? (
        <ErrorState
          title="Could not load analytics"
          error={analytics.error}
          onRetry={() => analytics.refetch()}
        />
      ) : analytics.data.total_requests === 0 ? (
        <EmptyState
          title={`No requests in the last ${window}`}
          hint="Point a client at this gateway, or widen the window above."
        />
      ) : (
        <TrafficSection
          window={window}
          report={analytics.data}
        />
      )}

      <LifetimeSection />
    </div>
  )
}

function TrafficSection({
  window,
  report,
}: {
  window: AnalyticsWindow
  report: AnalyticsReport
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Requests"
          value={count(report.total_requests)}
          hint={
            report.requests_per_second === null
              ? `over ${window}`
              : `${report.requests_per_second.toFixed(2)}/s over ${window}`
          }
        />
        <MetricCard
          label="Error rate"
          value={rate(report.error_rate)}
          hint="share of requests that did not succeed"
        />
        <MetricCard
          label="p95 latency"
          value={duration(report.p95_latency_ms)}
          hint="95% of requests were faster"
        />
        <MetricCard
          label="Models used"
          value={count(report.top_models.length)}
          hint={
            report.top_agents.length > 0
              ? `${report.top_agents.length} client agents seen`
              : "no client agents recorded"
          }
        />
      </div>

      <Panel
        title="Requests over time"
        description="Each column is one bucket; the red cap is the failed share."
        contentClassName="px-6 pb-2"
      >
        <TrafficChart buckets={report.buckets} bucketSizeMs={report.bucket_size_ms} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Busiest models" description={`Top models in the last ${window}.`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className={numericCell}>Requests</TableHead>
                <TableHead className={numericCell}>Tokens</TableHead>
                <TableHead className={numericCell}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.top_models.map((model) => (
                <TableRow key={model.model ?? "unknown"}>
                  <TableCell className="font-mono text-xs">
                    {modelName(model.model)}
                  </TableCell>
                  <TableCell className={numericCell}>
                    {count(model.total_requests)}
                  </TableCell>
                  <TableCell className={numericCell}>
                    {compactCount(model.total_tokens)}
                  </TableCell>
                  <TableCell className={numericCell}>
                    {model.est_cost === null ? "—" : cost(model.est_cost, "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Traffic by provider"
          description={`Share of requests in the last ${window}.`}
        >
          <div className="flex flex-col gap-2 px-6">
            {report.providers.map((provider) => {
              const share = (provider.total_requests / report.total_requests) * 100

              return (
                <div key={provider.provider_id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-mono">{provider.provider_id}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {count(provider.total_requests)} · {share.toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-chart-3 h-full rounded-full"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </>
  )
}

/** Lifetime totals: the same figures the Usage screen once owned. */
function LifetimeSection() {
  const lifetime = useQuery(usageStatsQuery)

  if (lifetime.isPending) {
    return <LoadingState className="h-40 w-full" />
  }

  if (lifetime.isError) {
    return (
      <ErrorState
        title="Could not load lifetime totals"
        error={lifetime.error}
        onRetry={() => lifetime.refetch()}
      />
    )
  }

  const { requests, tokens, cost: spend } = lifetime.data.data.totals

  if (requests.total === 0) {
    return (
      <EmptyState
        title="No requests recorded yet"
        hint="Lifetime totals appear here as soon as the first request lands."
      />
    )
  }

  return (
    <Panel
      title="Lifetime totals"
      description="Every request this instance has recorded, aggregated by the server."
    >
      <div className="grid gap-3 px-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Requests"
          value={count(requests.total)}
          hint={`${count(requests.success)} succeeded · ${count(requests.failed)} failed`}
          className="border-0 shadow-none"
        />
        <MetricCard
          label="Tokens"
          value={compactCount(tokens.total)}
          hint={`${compactCount(tokens.input)} in · ${compactCount(tokens.output)} out`}
          className="border-0 shadow-none"
        />
        <MetricCard
          label="Cached reads"
          value={compactCount(tokens.cache.read)}
          hint={`${compactCount(tokens.cache.write)} written to cache`}
          className="border-0 shadow-none"
        />
        <MetricCard
          label="Spend"
          value={cost(spend.total, spend.label)}
          hint={spend.estimated ? "Estimated from catalog pricing" : "Billed total"}
          className="border-0 shadow-none"
        />
      </div>
    </Panel>
  )
}
