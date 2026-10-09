import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { usageStatsQuery } from "@/api/dashboard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_authenticated/")({
  component: Usage,
})

/** Thousands separators, because a six-figure token count must be readable. */
const count = new Intl.NumberFormat("en-US")

function formatCost(total: number | null, label: string, estimated: boolean) {
  if (total === null) {
    // The server formats the fallback itself when no cost could be computed.
    return label
  }

  const amount = `$${total.toFixed(total < 1 ? 4 : 2)}`
  return estimated ? `${amount} (est.)` : amount
}

function Usage() {
  const stats = useQuery(usageStatsQuery)

  if (stats.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (stats.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load usage</AlertTitle>
        <AlertDescription>{stats.error.message}</AlertDescription>
      </Alert>
    )
  }

  const { requests, tokens, cost } = stats.data.data.totals
  const byModel = stats.data.data.by_model

  // A gateway with no traffic yet is the normal first state, not a failure.
  if (requests.total === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No requests yet</EmptyTitle>
          <EmptyDescription>
            Point a client at this gateway and send a request. Totals appear here as soon
            as the first one lands.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const failureRate = (requests.failed / requests.total) * 100

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-sm font-medium">Usage</h1>
        <p className="text-muted-foreground text-xs">
          Every recorded request, aggregated by the server.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Requests" value={count.format(requests.total)}>
          {requests.failed > 0 ? (
            <Badge variant="destructive">{count.format(requests.failed)} failed</Badge>
          ) : (
            <Badge variant="secondary">All succeeded</Badge>
          )}
        </Metric>

        <Metric label="Failure rate" value={`${failureRate.toFixed(1)}%`}>
          <span className="text-muted-foreground text-[0.625rem]">
            {count.format(requests.success)} succeeded
          </span>
        </Metric>

        <Metric label="Tokens" value={count.format(tokens.total)}>
          <span className="text-muted-foreground text-[0.625rem]">
            {count.format(tokens.input)} in · {count.format(tokens.output)} out
            {tokens.cache.read > 0 ? ` · ${count.format(tokens.cache.read)} cached` : ""}
          </span>
        </Metric>

        <Metric
          label="Spend"
          value={formatCost(cost.total, cost.label, cost.estimated)}
        >
          {/* `cost.label` is the formatted figure itself, so it cannot double as
              the caption. The caption explains what the number covers. */}
          <span className="text-muted-foreground text-[0.625rem]">
            {cost.estimated ? "Estimated from catalog pricing" : "Billed total"}
          </span>
        </Metric>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs">By model</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cached</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byModel.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-mono">{row.model}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count.format(row.total_requests)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count.format(row.total_input_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count.format(row.total_output_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count.format(row.total_cached_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.est_cost === null ? "—" : `$${row.est_cost.toFixed(4)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-lg tabular-nums">{value}</span>
        {children}
      </CardContent>
    </Card>
  )
}
