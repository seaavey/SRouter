import type { RequestLog } from "@/api/types"
import { Badge } from "@/components/arc/badge/badge"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import useProviderNames from "./hooks/useProviderNames"
import { formatCostUSD, formatTime, LATENCY, NUMBER, statusTone } from "./types"

export interface LogTableProps {
  logs: RequestLog[]
  onSelectLog: (log: RequestLog) => void
}

/** A row flat enough for the table to sort: one numeric field per sortable column. */
type LogTableRow = {
  id: string
  created_at: number
  status_code: number
  method: string
  path: string
  model: string
  provider: string
  provider_name: string
  tokens: number
  latency_ms: number
  cost: number | null
  cost_label: string
  record: RequestLog
}

const costValue = (log: RequestLog) => {
  const raw = log.costs?.total
  if (!raw) return null
  const value = Number(raw.replace("$", ""))
  return Number.isFinite(value) ? value : null
}

export function LogTable({ logs, onSelectLog }: LogTableProps) {
  const providerNames = useProviderNames()

  const rows: LogTableRow[] = logs.map((log) => ({
    id: log.id,
    created_at: log.created_at,
    status_code: log.status_code,
    method: log.method,
    path: log.path,
    model: log.resolved_model ?? log.model ?? "Unknown model",
    provider: log.provider ?? "",
    provider_name: providerNames.get(log.provider ?? "") ?? log.provider ?? "",
    tokens: log.tokens.total ?? 0,
    latency_ms: log.latency_ms,
    cost: costValue(log),
    cost_label: formatCostUSD(log.costs?.total) ?? "",
    record: log,
  }))

  const columns: DataColumn<LogTableRow>[] = [
    {
      key: "created_at",
      label: "Time",
      width: 150,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatTime(row.created_at)}
        </span>
      ),
    },
    {
      key: "status_code",
      label: "Status",
      width: 96,
      // Sorts on the numeric code, but a badge is not a number to align right.
      numeric: false,
      render: (_value, row) => (
        <Badge
          tone={statusTone(row.status_code)}
          size="sm"
          className="font-mono font-medium"
        >
          {row.status_code}
        </Badge>
      ),
    },
    {
      key: "path",
      label: "Request",
      width: 430,
      // The method plus a path sorts by neither half usefully.
      sortable: false,
      render: (_value, row) => (
        // The row opens the sheet on click; this button is the keyboard and
        // screen-reader route to the same surface.
        <button
          type="button"
          onClick={() => onSelectLog(row.record)}
          aria-label={`Open details for ${row.method} ${row.path}`}
          className="flex w-full min-w-0 items-baseline gap-2 rounded-[var(--radius-control)] text-left focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none"
        >
          <span className="shrink-0 font-mono text-xs font-medium text-foreground">
            {row.method}
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {row.path}
          </span>
        </button>
      ),
    },
    {
      key: "model",
      label: "Model",
      width: 220,
      render: (_value, row) => (
        <span
          className="block truncate font-mono text-xs text-foreground"
          title={row.model}
        >
          {row.model}
        </span>
      ),
    },
    {
      key: "provider_name",
      label: "Provider",
      width: 150,
      render: (_value, row) => (
        <span
          className="block truncate text-xs text-muted-foreground"
          title={row.provider}
        >
          {row.provider_name}
        </span>
      ),
    },
    {
      key: "tokens",
      label: "Tokens",
      width: 96,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-foreground tabular-nums">
          {row.tokens > 0 ? NUMBER.format(row.tokens) : ""}
        </span>
      ),
    },
    {
      key: "latency_ms",
      label: "Latency",
      width: 96,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {LATENCY(row.latency_ms)}
        </span>
      ),
    },
    {
      key: "cost",
      label: "Cost",
      width: 96,
      numeric: true,
      render: (_value, row) => (
        <span className="text-xs text-foreground tabular-nums">
          {row.cost_label}
        </span>
      ),
    },
  ]

  return (
    <SortableDataTable
      rows={rows}
      columns={columns}
      rowKey="id"
      caption="Gateway request log"
      defaultSort={{ key: "created_at", direction: "desc" }}
      onRowActivate={(row) => onSelectLog(row.record)}
    />
  )
}
