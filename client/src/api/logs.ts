import { queryOptions, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { request } from "./client"
import type {
  AnalyticsReport,
  LiveEvent,
  LogsResponse,
  RequestLog,
  UsageStatsReport,
} from "./types"

export type AnalyticsWindow = "1h" | "24h" | "7d" | "30d"

export interface LogsQueryParams {
  page?: number
  limit?: number
  status?: "error" | "success"
  /** One key's rows; absent means every key. */
  apiKeyID?: string
  /** Inclusive lower bound, epoch milliseconds. */
  from?: number
  /** Exclusive upper bound, epoch milliseconds. */
  to?: number
}

/**
 * `GET /v1/logs`. Paginated request log audit trail recorded in SQLite.
 */
export function logsQuery(params: LogsQueryParams = {}) {
  const { page = 1, limit = 50, status, apiKeyID, from, to } = params
  const search = new URLSearchParams()
  search.set("page", String(page))
  search.set("limit", String(limit))
  if (status) {
    search.set("status", status)
  }
  if (apiKeyID) {
    search.set("api_key_id", apiKeyID)
  }
  if (from !== undefined) {
    search.set("from", String(from))
  }
  if (to !== undefined) {
    search.set("to", String(to))
  }

  return queryOptions({
    queryKey: [
      "logs",
      "list",
      { page, limit, status, apiKeyID, from, to },
    ] as const,
    queryFn: ({ signal }) =>
      request<LogsResponse>(`/v1/logs?${search.toString()}`, { signal }),
    staleTime: 10_000,
  })
}

/**
 * `GET /v1/logs/stats`. All-time usage totals, also carried by `usage.updated`
 * SSE events.
 */
export const usageStatsQuery = queryOptions({
  queryKey: ["logs", "stats"] as const,
  queryFn: ({ signal }) =>
    request<UsageStatsReport>("/v1/logs/stats", { signal }),
  staleTime: 30_000,
})

/**
 * `GET /v1/logs/analytics?window={window}`. Aggregated telemetry buckets and top
 * models for the requested time window (default "24h").
 */
export function analyticsQuery(window: AnalyticsWindow = "24h") {
  return queryOptions({
    queryKey: ["logs", "analytics", window] as const,
    queryFn: ({ signal }) =>
      request<AnalyticsReport>(
        `/v1/logs/analytics?window=${encodeURIComponent(window)}`,
        { signal }
      ),
    staleTime: 30_000,
  })
}

export type SSEConnectionStatus = "connecting" | "connected" | "disconnected"

export interface UseLogEventsOptions {
  /** Optional callback fired when a new request log is broadcast */
  onRequestLogged?: (log: RequestLog) => void
  /** Whether the SSE connection should be open. Defaults to true. */
  enabled?: boolean
}

/**
 * Connects to `GET /v1/logs/events` via same-origin Server-Sent Events (SSE).
 *
 * Automatically updates `usageStatsQuery` cache when `usage.updated` is
 * received, debounces `analyticsQuery` cache invalidation on `request.logged`,
 * and closes the connection cleanly on unmount to stay within the server's
 * concurrent stream budget (16 slots).
 */
export function useLogEvents(options: UseLogEventsOptions = {}) {
  const { onRequestLogged, enabled = true } = options
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SSEConnectionStatus>(
    enabled ? "connecting" : "disconnected"
  )
  const [lastLog, setLastLog] = useState<RequestLog | null>(null)

  const onLogRef = useRef(onRequestLogged)
  useEffect(() => {
    onLogRef.current = onRequestLogged
  }, [onRequestLogged])

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return
    }

    let isMounted = true
    const es = new EventSource("/v1/logs/events", { withCredentials: true })

    es.onopen = () => {
      if (isMounted) {
        setStatus("connected")
      }
    }

    es.onmessage = (event) => {
      if (!isMounted) return
      try {
        const raw = JSON.parse(event.data) as LiveEvent
        if (raw.type === "connected") {
          setStatus("connected")
        } else if (raw.type === "usage.updated") {
          queryClient.setQueryData(usageStatsQuery.queryKey, raw.stats)
        } else if (raw.type === "request.logged") {
          setLastLog(raw.log)
          onLogRef.current?.(raw.log)
          // Debounce analytics invalidation so sudden bursts of requests don't thrash the server
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current)
          }
          debounceTimerRef.current = setTimeout(() => {
            void queryClient.invalidateQueries({
              queryKey: ["logs", "analytics"],
            })
          }, 1500)
        }
      } catch {
        // SSE comments (: ping) and non-JSON framing are ignored
      }
    }

    es.onerror = () => {
      if (isMounted) {
        setStatus("disconnected")
      }
    }

    return () => {
      isMounted = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      es.close()
    }
  }, [enabled, queryClient])

  return {
    status,
    isConnected: status === "connected",
    lastLog,
  }
}
