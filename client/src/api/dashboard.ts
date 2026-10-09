import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type { LogsResponse, ProviderListResponse, UsageStatsReport } from "./types"

/**
 * `GET /v1/logs/stats` — request, token, and cost totals with a per-model
 * breakdown. This is the usage screen's only source; the server aggregates, so
 * the client never sums a page of rows and calls it a total.
 */
export const usageStatsQuery = queryOptions({
  queryKey: ["logs", "stats"] as const,
  queryFn: ({ signal }) => request<UsageStatsReport>("/v1/logs/stats", { signal }),
})

/**
 * `GET /v1/providers` — every configured provider with its connection state and
 * model list. The screen sorts on `status.state`, so the response is used as-is
 * and never re-shaped into a second, divergent view.
 */
export const providersQuery = queryOptions({
  queryKey: ["providers"] as const,
  queryFn: ({ signal }) => request<ProviderListResponse>("/v1/providers", { signal }),
})

/**
 * The filters `/v1/logs` actually accepts. `status` is a two-way split — the
 * server maps `success` to 2xx and `error` to everything else — so there is no
 * per-code filtering to offer.
 */
export type LogsFilter = "all" | "success" | "error"

export type LogsQueryParams = {
  page: number
  limit: number
  filter: LogsFilter
}

/**
 * `GET /v1/logs` — one page of request records.
 *
 * `pagination` is only present when `page` is sent, and it is sent on every
 * request here, so the total is always available.
 */
export const logsQuery = ({ page, limit, filter }: LogsQueryParams) =>
  queryOptions({
    queryKey: ["logs", { page, limit, filter }] as const,
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (filter !== "all") search.set("status", filter)

      return request<LogsResponse>(`/v1/logs?${search}`, { signal })
    },
  })
