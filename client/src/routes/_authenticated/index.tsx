import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Cpu, Download, Radio, Zap } from "lucide-react"
import { useMemo, useState } from "react"

import { analyticsQuery, type AnalyticsWindow, useLogEvents } from "@/api/logs"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import {
  LineChart,
  type LineChartDatum,
  type LineChartSeries,
} from "@/components/arc/line-chart/line-chart"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import {
  SortableDataTable,
  type DataColumn,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { SectionHeader } from "@/components/layout/section-header"

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "SRouter - Gateway overview" }] }),
  component: OverviewPage,
})

const RANGE_OPTIONS: { value: AnalyticsWindow; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
]

type Metric = "tokens" | "requests"

const METRIC_OPTIONS = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
]

/** The question the plot answers, in the terms the operator asks it. It follows
 * the metric switch, so the heading always names what is actually drawn. */
const WINDOW_QUESTIONS: Record<Metric, Record<AnalyticsWindow, string>> = {
  tokens: {
    "1h": "Token throughput per minute, past hour?",
    "24h": "Token throughput per hour, past day?",
    "7d": "Token throughput per 6 hours, past week?",
    "30d": "Token throughput per day, past month?",
  },
  requests: {
    "1h": "How many requests per minute, past hour?",
    "24h": "How many requests per hour, past day?",
    "7d": "How many requests per 6 hours, past week?",
    "30d": "How many requests per day, past month?",
  },
}

const SERIES: LineChartSeries[] = [
  { key: "total_tokens", label: "Total tokens", area: true },
  { key: "prompt_tokens", label: "Input" },
  { key: "completion_tokens", label: "Output" },
  { key: "cached_tokens", label: "Cached", dashed: true },
  { key: "requests", label: "Requests", area: true },
]

interface ModelMetricRow extends Record<string, unknown> {
  id: string
  model: string
  provider: string
  requests: number
  tokens: number
  cachedRate: string
  cost: number
}

const TABLE_COLUMNS: DataColumn<ModelMetricRow>[] = [
  {
    key: "model",
    label: "Model",
    width: 180,
    sortable: true,
    render: (_val, row) => (
      <span className="font-mono text-xs font-medium whitespace-nowrap text-foreground">
        {row.model}
      </span>
    ),
  },
  {
    key: "provider",
    label: "Provider",
    width: 140,
    sortable: true,
    render: (_val, row) => (
      <Badge tone="neutral" size="sm" className="whitespace-nowrap">
        {row.provider}
      </Badge>
    ),
  },
  {
    key: "requests",
    label: "Requests",
    width: 110,
    numeric: true,
    sortable: true,
    render: (_val, row) => (
      <span className="whitespace-nowrap text-foreground tabular-nums">
        {row.requests.toLocaleString()}
      </span>
    ),
  },
  {
    key: "tokens",
    label: "Tokens",
    width: 130,
    numeric: true,
    sortable: true,
    render: (_val, row) => (
      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
        {row.tokens.toLocaleString()}
      </span>
    ),
  },
  {
    key: "cachedRate",
    label: "Prompt cache",
    width: 125,
    numeric: true,
    sortable: true,
    render: (_val, row) => (
      <span className="font-medium whitespace-nowrap text-foreground tabular-nums">
        {row.cachedRate}
      </span>
    ),
  },
  {
    key: "cost",
    label: "Est. cost",
    width: 115,
    numeric: true,
    sortable: true,
    render: (_val, row) => (
      <span className="font-medium whitespace-nowrap text-foreground tabular-nums">
        ${row.cost.toFixed(2)}
      </span>
    ),
  },
]

function OverviewPage() {
  const [range, setRange] = useState<AnalyticsWindow>("24h")
  const [metric, setMetric] = useState<Metric>("tokens")

  const {
    data: analytics,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(analyticsQuery(range))
  const { isConnected, status: sseStatus, lastLog } = useLogEvents()

  // Every figure on this page reads the analytics window, so the KPI row, the
  // plot, and the table cannot disagree about the period they describe.
  const totalRequests = analytics?.total_requests ?? 0
  const latencyP95 = analytics?.p95_latency_ms ?? 0
  const windowCost = analytics?.est_cost ?? 0
  // `error_rate` is a fraction (0.073 means 7.3%), so it is scaled for display;
  // `requests_per_second` was dropped from this row because the server derives
  // it from the last 60 seconds, so it was the one card that did not answer the
  // selected range.
  const errorRate = (analytics?.error_rate ?? 0) * 100

  // Buckets cover the full window; top_models is intentionally limited to ten.
  const tokenTotals = useMemo(() => {
    if (!analytics?.buckets || analytics.buckets.length === 0) {
      return { prompt: 0, completion: 0, cached: 0, total: 0, hitRate: 0 }
    }
    let prompt = 0
    let completion = 0
    let cached = 0
    let total = 0
    for (const bucket of analytics.buckets) {
      prompt += bucket.prompt_tokens
      completion += bucket.completion_tokens
      cached += bucket.cached_tokens
      total += bucket.total_tokens
    }
    const hitRate = prompt > 0 ? (cached / prompt) * 100 : 0
    return { prompt, completion, cached, total, hitRate }
  }, [analytics])

  const chartData: LineChartDatum[] = useMemo(() => {
    if (!analytics?.buckets || analytics.buckets.length === 0) {
      return []
    }

    const buckets = analytics.buckets
    const count = buckets.length

    return buckets.map((bucket, index) => {
      const date = new Date(bucket.bucket_start)
      let label: string
      let axisLabel: string | undefined

      if (range === "1h") {
        label = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
        if (index % 12 === 0 || index === count - 1) {
          axisLabel = label
        }
      } else if (range === "24h") {
        label = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
        if (index % 4 === 0 || index === count - 1) {
          axisLabel = label
        }
      } else if (range === "7d") {
        label = `${date.toLocaleDateString([], { weekday: "short" })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        if (index % 4 === 0 || index === count - 1) {
          axisLabel = date.toLocaleDateString([], { weekday: "short" })
        }
      } else {
        label = date.toLocaleDateString([], { month: "short", day: "numeric" })
        if (index % 5 === 0 || index === count - 1) {
          axisLabel = label
        }
      }

      return {
        key: String(bucket.bucket_start),
        label,
        axisLabel,
        values: {
          requests: bucket.total_requests,
          total_tokens: bucket.total_tokens,
          prompt_tokens: bucket.prompt_tokens,
          completion_tokens: bucket.completion_tokens,
          cached_tokens: bucket.cached_tokens,
        },
      }
    })
  }, [analytics, range])

  const modelRows: ModelMetricRow[] = useMemo(() => {
    if (!analytics?.top_models) {
      return []
    }

    return analytics.top_models.map((item, index) => {
      const model = item.model ?? "unknown"
      // Prompt is the denominator: cached reads are a subset of it, whereas
      // `total_tokens` also carries the completion, so the rate would sink as
      // the answer grows.
      const cachedRate =
        item.prompt_tokens > 0
          ? `${((item.cached_tokens / item.prompt_tokens) * 100).toFixed(1)}%`
          : "0.0%"

      return {
        id: `${index}-${model}-${item.provider_id}`,
        model,
        provider: item.provider_id,
        requests: item.total_requests,
        tokens: item.total_tokens,
        cachedRate,
        // SUM() over zero rows is NULL, not zero, so the row's own null is the
        // honest value for "no logged cost in this window".
        cost: item.est_cost ?? 0,
      }
    })
  }, [analytics])

  const handleExport = () => {
    const exportPayload = {
      exported_at: new Date().toISOString(),
      window: range,
      analytics,
    }
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `srouter-telemetry-${range}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Telemetry report exported")
  }

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-5 overflow-hidden sm:gap-6">
      <SectionHeader
        title="Gateway overview"
        description="Live operational telemetry, model routing status, and traffic throughput."
        badge={
          isConnected
            ? "Live stream active"
            : sseStatus === "connecting"
              ? "Connecting..."
              : "Stream idle"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onValueChange={(val) => setRange(val as AnalyticsWindow)}
              label="Time range"
            />
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download size={14} aria-hidden="true" />
              <span>Export</span>
            </Button>
          </div>
        }
      />

      {isError ? (
        <section
          className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
          aria-label="Gateway telemetry unavailable"
        >
          <EmptyState
            title="Could not load gateway telemetry"
            description={`The analytics endpoint did not answer (${error instanceof Error ? error.message : "unknown error"}). The gateway may still be serving traffic; this screen only lost its read path.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        </section>
      ) : (
        <>
          {/* Telemetry Summary & Token Ratio Section */}
          <section
            className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12"
            aria-label={`Key gateway telemetry, past ${range}`}
          >
            {/* Core KPI metrics in a streamlined card */}
            <div className="flex flex-col justify-between rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5 lg:col-span-7">
              {/* The figures used to render as `0` until the window arrived,
                  which read as a correction a moment later. */}
              {isPending ? (
                <Skeleton label="Loading gateway totals" lines={3} />
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Requests
                    </div>
                    <div className="mt-1 text-lg font-medium text-foreground tabular-nums">
                      {totalRequests.toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      past {range}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      P95 Latency
                    </div>
                    <div className="mt-1 text-lg font-medium text-foreground tabular-nums">
                      {latencyP95}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        ms
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      upstream time
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Error Rate
                    </div>
                    <div className="mt-1 text-lg font-medium text-foreground tabular-nums">
                      {errorRate.toFixed(1)}
                      <span className="text-xs font-normal text-muted-foreground">
                        %
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      failures
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Est. Spend
                    </div>
                    <div className="mt-1 text-lg font-medium text-foreground tabular-nums">
                      ${windowCost.toFixed(2)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      past {range}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Token Traffic & Cache Efficiency breakdown */}
            <div className="flex flex-col justify-between rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5 lg:col-span-5">
              {isPending ? (
                <Skeleton label="Loading token totals" lines={3} />
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Zap
                          size={13}
                          className="text-foreground"
                          aria-hidden="true"
                        />
                        <span>Token Throughput</span>
                      </div>
                      <span className="text-xs font-medium text-foreground tabular-nums">
                        {tokenTotals.total.toLocaleString()} total
                      </span>
                    </div>

                    {/* Ratio bar */}
                    <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        style={{
                          width: `${tokenTotals.total > 0 ? (tokenTotals.prompt / tokenTotals.total) * 100 : 0}%`,
                        }}
                        className="bg-foreground transition-all duration-300"
                        title={`Input: ${tokenTotals.prompt.toLocaleString()}`}
                      />
                      <div
                        style={{
                          width: `${tokenTotals.total > 0 ? (tokenTotals.completion / tokenTotals.total) * 100 : 0}%`,
                        }}
                        className="bg-muted-foreground/60 transition-all duration-300"
                        title={`Output: ${tokenTotals.completion.toLocaleString()}`}
                      />
                    </div>
                  </div>

                  {/* Details & Cache stats */}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <span
                          className="size-1.5 rounded-full bg-foreground"
                          aria-hidden="true"
                        />
                        <span>In:</span>
                        <strong className="font-medium text-foreground tabular-nums">
                          {tokenTotals.prompt.toLocaleString()}
                        </strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className="size-1.5 rounded-full bg-muted-foreground/60"
                          aria-hidden="true"
                        />
                        <span>Out:</span>
                        <strong className="font-medium text-foreground tabular-nums">
                          {tokenTotals.completion.toLocaleString()}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span>Cache Hit:</span>
                      <Badge
                        tone={tokenTotals.hitRate > 0 ? "success" : "neutral"}
                        size="sm"
                      >
                        {tokenTotals.hitRate.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Traffic Trend Section using UIARC LineChart */}
          <section
            className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
            aria-label="Gateway throughput over time"
          >
            <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Radio
                  size={15}
                  className="shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-medium tracking-tight text-foreground">
                  {WINDOW_QUESTIONS[metric][range]}
                </h2>
              </div>
              <SegmentedControl
                options={METRIC_OPTIONS}
                value={metric}
                onValueChange={(value) => setMetric(value as Metric)}
                label="Chart metric"
              />
            </div>

            <div className="w-full min-w-0 overflow-hidden">
              <LineChart
                data={chartData}
                series={SERIES}
                hiddenSeries={
                  metric === "tokens"
                    ? ["requests"]
                    : [
                        "total_tokens",
                        "prompt_tokens",
                        "completion_tokens",
                        "cached_tokens",
                      ]
                }
                label="Gateway telemetry"
                height={200}
                loading={isPending}
                emptyLabel="No traffic recorded in this window"
                legend={metric === "tokens"}
              />
            </div>
          </section>

          {/* Model Breakdown Section using UIARC SortableDataTable */}
          <section
            className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
            aria-label="Top active models"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Cpu
                  size={15}
                  className="shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-medium tracking-tight text-foreground">
                  Models routed, past {range}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {lastLog && (
                  <span className="font-mono text-xs text-muted-foreground">
                    Latest: {lastLog.model ?? "request"} ({lastLog.status_code})
                  </span>
                )}
                <Badge tone="neutral" size="sm">
                  {modelRows.length === 1
                    ? "1 model active"
                    : `${modelRows.length} models active`}
                </Badge>
              </div>
            </div>

            {modelRows.length === 0 ? (
              <EmptyState
                title={
                  isPending
                    ? "Reading the request log"
                    : "No requests recorded in this window"
                }
                description={
                  isPending
                    ? "Loading per-model telemetry for the selected range."
                    : "Per-model performance populates automatically as completions are routed through SRouter. Widen the range above to look further back."
                }
              />
            ) : (
              <div className="w-full min-w-0">
                <SortableDataTable
                  rows={modelRows}
                  columns={TABLE_COLUMNS}
                  rowKey="id"
                  caption={`Active model performance, past ${range}`}
                  defaultSort={{ key: "requests", direction: "desc" }}
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
