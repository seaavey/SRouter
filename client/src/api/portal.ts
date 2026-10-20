import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type {
  LogsResponse,
  PortalLoginInput,
  PortalMe,
  UserResponse,
} from "./types"

/**
 * `GET /v1/portal/me`. The route gate waits on this one answer, so retrying
 * a dead session three more times only delays the redirect.
 */
export const portalMeQuery = queryOptions({
  queryKey: ["portal", "me"] as const,
  queryFn: ({ signal }) => request<PortalMe>("/v1/portal/me", { signal }),
  retry: false,
  // D12: the console has no stream, so a focus refetch is the liveness check
  // that notices the operator disabled the account or rotated its token.
  staleTime: 0,
  refetchOnWindowFocus: true,
})

export type PortalLogStatus = "error" | "success"

/**
 * `GET /v1/portal/logs`. The server scopes rows to the signed-in customer's
 * keys; paging and ordering are server-side, so the screen sorts nothing.
 */
export function portalLogsQuery(
  page = 1,
  limit = 50,
  status?: PortalLogStatus
) {
  const search = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  })
  if (status) {
    search.set("status", status)
  }

  return queryOptions({
    queryKey: ["portal", "logs", { page, limit, status }] as const,
    queryFn: ({ signal }) =>
      request<LogsResponse>(`/v1/portal/logs?${search.toString()}`, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

/** `POST /v1/portal/login` — a `200` is the authentication; the cookie follows. */
export function loginPortal(token: string) {
  const input: PortalLoginInput = { token }

  return request<UserResponse>("/v1/portal/login", {
    method: "POST",
    body: input,
  })
}

/** `POST /v1/portal/logout` — 204; the server clears the shared session cookie. */
export function logoutPortal() {
  return request<void>("/v1/portal/logout", { method: "POST" })
}
