import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type {
  AdminStatus,
  AnalyticsReport,
  KeyListResponse,
  LogsResponse,
  ProviderListResponse,
  QuotaResponse,
  UsageStatsReport,
} from "./types"

/**
 * Every server query the dashboard makes, in one module.
 *
 * Two rules hold throughout. Query keys are hierarchical on the resource, so an
 * invalidation can target a prefix. And every parameter that changes the
 * response is part of the key, so two screens asking different questions never
 * share a cache entry by accident.
 */

/**
 * `GET /v1/admin/status`. The session gate and the login screen both read this
 * entry, so a successful login must refresh the same key the guard consults.
 */
export const adminStatusQuery = queryOptions({
  queryKey: ["admin", "status"] as const,
  queryFn: ({ signal }) => request<AdminStatus>("/v1/admin/status", { signal }),
  // Session state is server-owned and changes out of band (cookie expiry, the
  // server restarted against a different database). Always revalidate.
  staleTime: 0,
})

/**
 * `GET /v1/logs/stats` — lifetime request, token, and cost totals with a
 * per-model breakdown. The server aggregates, so the client never sums a page
 * of rows and presents it as a total.
 */
export const usageStatsQuery = queryOptions({
  queryKey: ["logs", "stats"] as const,
  queryFn: ({ signal }) => request<UsageStatsReport>("/v1/logs/stats", { signal }),
})

/** The windows `/v1/logs/analytics` accepts. An unknown one is a `400`. */
export type AnalyticsWindow = "1h" | "24h" | "7d" | "30d"

/**
 * `GET /v1/logs/analytics` — traffic over a window: error rate, p95 latency,
 * per-bucket series, and the top models, agents, and providers.
 */
export const analyticsQuery = (window: AnalyticsWindow) =>
  queryOptions({
    queryKey: ["logs", "analytics", window] as const,
    queryFn: ({ signal }) =>
      request<AnalyticsReport>(`/v1/logs/analytics?window=${window}`, { signal }),
    // Buckets move on their own schedule; a short stale window keeps the charts
    // honest without polling harder than the data changes.
    staleTime: 30_000,
  })

/**
 * `GET /v1/providers` — every configured provider with its connection state and
 * model list. Used as-is; the screen sorts, it does not re-shape.
 */
export const providersQuery = queryOptions({
  queryKey: ["providers"] as const,
  queryFn: ({ signal }) => request<ProviderListResponse>("/v1/providers", { signal }),
})

/**
 * `GET /v1/quota` — per-account quota windows and per-model usage metrics. This
 * is the source for the quota gauges.
 *
 * The server caches this for a short interval and coalesces concurrent misses,
 * so `refresh=true` is passed only when the operator asks for it.
 */
export const quotaQuery = (refresh = false) =>
  queryOptions({
    queryKey: ["quota", { refresh }] as const,
    queryFn: ({ signal }) =>
      request<QuotaResponse>(`/v1/quota${refresh ? "?refresh=true" : ""}`, { signal }),
  })

/** `GET /v1/keys` — the issued API keys with their usage. */
export const apiKeysQuery = queryOptions({
  queryKey: ["keys"] as const,
  queryFn: ({ signal }) => request<KeyListResponse>("/v1/keys", { signal }),
})

/**
 * The filters `/v1/logs` accepts. `status` is a two-way split — the server maps
 * `success` to 2xx and `error` to everything else — so there is no per-code
 * filtering to offer.
 */
export type LogsFilter = "all" | "success" | "error"

/**
 * `GET /v1/logs` — one page of request records. `pagination` is only present
 * when `page` is sent, and this always sends it, so the total is available.
 */
export const logsQuery = (page: number, limit: number, filter: LogsFilter) =>
  queryOptions({
    queryKey: ["logs", "list", { page, limit, filter }] as const,
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (filter !== "all") search.set("status", filter)

      return request<LogsResponse>(`/v1/logs?${search}`, { signal })
    },
  })
