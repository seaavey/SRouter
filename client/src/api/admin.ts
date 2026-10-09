import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type { AdminStatus } from "./types"

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
