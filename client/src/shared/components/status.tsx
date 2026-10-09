import { Badge } from "@/shared/components/ui/badge"

/**
 * The status vocabulary from `client/DESIGN.md`, in one place.
 *
 * Every state pairs its color with a word: an operator on a sunlit monitor, or
 * with a color vision deficiency, must still get the state. The color is the
 * second signal, never the only one.
 */

export function ProviderStatusBadge({
  state,
  connections,
}: {
  state: "connected" | "no_connections"
  connections: number
}) {
  if (state === "connected") {
    return (
      <Badge variant="secondary">
        Connected{connections > 1 ? ` · ${connections}` : ""}
      </Badge>
    )
  }

  return <Badge variant="destructive">No connections</Badge>
}

/** A quota window's state, as `LiveModelQuotaItem.status` reports it. */
export function QuotaStatusBadge({
  status,
}: {
  status: "ok" | "warning" | "exhausted"
}) {
  return (
    <Badge variant={status === "ok" ? "secondary" : "destructive"}>
      {{ ok: "Within limit", warning: "Running low", exhausted: "Exhausted" }[status]}
    </Badge>
  )
}

/**
 * An HTTP status code. 2xx is a success, 4xx is the caller's mistake, and 5xx
 * is the gateway's own fault — the three read differently because the operator
 * scanning the table is looking for the third.
 */
export function HttpStatusBadge({ code }: { code: number }) {
  const variant = code >= 500 ? "destructive" : code >= 400 ? "outline" : "secondary"

  return (
    <Badge variant={variant} className="font-mono tabular-nums">
      {code}
    </Badge>
  )
}

/** An on/off flag, for rows like an API key's `enabled`. */
export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "secondary" : "outline"}>
      {enabled ? "Active" : "Disabled"}
    </Badge>
  )
}
