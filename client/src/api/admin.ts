import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type {
  AdminAuthResult,
  AdminLoginInput,
  AdminSetupInput,
  AdminStatus,
} from "./types"

/**
 * `GET /v1/admin/status`. The one query the whole auth flow shares: the root
 * guard reads it through `ensureQueryData` before rendering a protected route,
 * and the login page reads it to decide between the setup and login forms.
 *
 * Both must observe the same cache entry, or a successful login would leave the
 * guard looking at a stale `authenticated: false`.
 */
export const adminStatusQuery = queryOptions({
  queryKey: ["admin", "status"] as const,
  queryFn: ({ signal }) => request<AdminStatus>("/v1/admin/status", { signal }),
  // Session state is server-owned and changes out of band (cookie expiry, the
  // server restarted with a different database). Always revalidate.
  staleTime: 0,
})

/** `POST /v1/admin/setup` — first run only, loopback callers only. */
export function setupAdmin(input: AdminSetupInput) {
  return request<AdminAuthResult>("/v1/admin/setup", {
    method: "POST",
    body: input,
  })
}

/** `POST /v1/admin/login` — throttled per client address by the server. */
export function loginAdmin(input: AdminLoginInput) {
  return request<AdminAuthResult>("/v1/admin/login", {
    method: "POST",
    body: input,
  })
}

/** `POST /v1/admin/logout` — 204; the server clears the session cookie. */
export function logoutAdmin() {
  return request<void>("/v1/admin/logout", { method: "POST" })
}
