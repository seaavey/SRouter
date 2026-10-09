import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { request } from "@/api/client"
import type { KeyListResponse } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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

export const Route = createFileRoute("/_authenticated/keys")({
  component: APIKeys,
})

const count = new Intl.NumberFormat("en-US")

function APIKeys() {
  const keys = useQuery({
    queryKey: ["keys"] as const,
    queryFn: ({ signal }) => request<KeyListResponse>("/v1/keys", { signal }),
  })

  if (keys.isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (keys.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load API keys</AlertTitle>
        <AlertDescription>{keys.error.message}</AlertDescription>
      </Alert>
    )
  }

  if (keys.data.data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No API keys</EmptyTitle>
          <EmptyDescription>
            With no keys, this gateway accepts requests from loopback only. Create one
            before exposing it to another machine.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-sm font-medium">API keys</h1>
        <p className="text-muted-foreground text-xs">
          {keys.data.data.length} issued. The full secret is shown once, when the key is
          created.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Tokens used</TableHead>
              <TableHead className="text-right">Quota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.data.data.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {key.key_prefix}…
                </TableCell>
                <TableCell>
                  {key.enabled ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count.format(key.usage_tokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {key.quota_limit > 0 ? count.format(key.quota_limit) : "Unlimited"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
