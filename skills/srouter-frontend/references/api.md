# API Integration

## The one network layer

`src/api/client.ts` exports `request<T>()` and `APIError`. Everything goes through it.

```ts
const status = await request<AdminStatus>("/v1/admin/status")
await request<{ authenticated: boolean }>("/v1/admin/login", {
  method: "POST",
  body: { password },
})
```

Options are `{ method, body, signal }`; `method` is typed `"GET" | "POST" | "PATCH" | "DELETE"` — **there is no PUT**, even though the server declares a few `PUT` routes.

Behaviour worth knowing:

- `credentials: "include"` is always set (the session cookie is the credential).
- `204` resolves to `undefined as T`.
- A non-JSON body (proxy error page, HTML 404) is tolerated: it is surfaced as the status, not a parse failure.
- `!response.ok` throws `APIError` built from the server's `ErrorEnvelope`.

`request` does **not** prefix a base URL. Paths are written literally (`"/v1/admin/status"`), because requests are same-origin by design.

## Error contract

The server answers every error with `ErrorEnvelope` (`{ error: { message, type, code, param } }`, all optional except `message`).

```ts
export class APIError extends Error {
  readonly status: number
  readonly code: string | null
  readonly param: string | null
  get isUnauthenticated(): boolean // status === 401 && code === "authentication_required"
}
```

**Branch on `status` and `code`, never on `message`** — the message is prose the server may reword. `isUnauthenticated` is the redirect-to-login signal.

User-facing text comes from a local mapping helper, as in `src/routes/login.tsx`:

```ts
function describe(error: unknown) {
  if (!(error instanceof APIError)) return "Could not reach the server."
  if (error.status === 429)
    return "Too many attempts. Wait a moment and try again."
  return error.message
}
```

A `429` on an auth route is the server's per-address login throttle, not the gateway rate limiter.

## Query factories

Declare a factory next to the endpoint it calls, in `src/api/<domain>.ts`:

```ts
export const adminStatusQuery = queryOptions({
  queryKey: ["admin", "status"] as const,
  queryFn: ({ signal }) => request<AdminStatus>("/v1/admin/status", { signal }),
  staleTime: 0,
})
```

Always forward the `signal` so a route unmount aborts the request.

**The `["admin", "status"]` cache entry is load-bearing.** The guard (`ensureQueryData`) and the login page (`useQuery`) must observe the same entry, so after a successful login or setup the screen invalidates by that key before navigating:

```ts
await queryClient.invalidateQueries({ queryKey: adminStatusQuery.queryKey })
await navigate({ to: redirect ?? "/", replace: true })
```

Skip the invalidation and the guard keeps seeing `authenticated: false` while the cookie says otherwise.

## Authentication as a client sees it

- The session is an **HttpOnly `SameSite=Lax` cookie with a 7-day life**, set by `POST /v1/admin/setup` or `POST /v1/admin/login`. Nothing is stored in JS.
- `GET /v1/admin/status` returns `{ setup_required, authenticated }` and is how the client decides between the setup form, the login form, and the dashboard.
- Read surfaces accept _either_ an API key _or_ the admin session cookie — the cookie is what a browser dashboard uses.
- Operator surfaces (`/v1/keys`, model writes, provider writes, `/v1/settings` mutations, database transfer) require the session **and** pass the server's `Origin` CSRF check. A same-origin `fetch` satisfies it; a rewrite that strips `Origin` breaks it.
- Sessions expire server-side; a `401` with code `authentication_required` means redirect to `/login`.

## Endpoint table

All paths are relative to the origin. "Auth" is what the mount requires.

| Method + path                                                                              | Auth                          | Response type                               |
| ------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------- |
| `GET /health`                                                                              | none                          | `HealthResponse`                            |
| `GET /v1`                                                                                  | none                          | `ApiInfo`                                   |
| `GET /v1/admin/status`                                                                     | none                          | `AdminStatus`                               |
| `POST /v1/admin/setup`                                                                     | none (first run)              | `201 { authenticated: true }`               |
| `POST /v1/admin/login`                                                                     | none (throttled)              | `200 { authenticated: true }`               |
| `POST /v1/admin/change-password`                                                           | session                       | `{ message }`, or `401 invalid_credentials` |
| `POST /v1/admin/logout`                                                                    | session                       | — (`204`, clears the cookie)                |
| `GET /v1/keys`                                                                             | session                       | `KeyListResponse`                           |
| `POST /v1/keys`                                                                            | session                       | `CreatedAPIKeyResponse`                     |
| `PATCH /v1/keys/{id}`                                                                      | session                       | `APIKeyResponse`                            |
| `DELETE /v1/keys/{id}`                                                                     | session                       | — (`204`)                                   |
| `POST /v1/keys/{id}/credit`                                                                | session                       | `APIKeyResponse`                            |
| `GET /v1/models`                                                                           | key or session                | `ModelListResponse`                         |
| `GET /v1/models/{model}`                                                                   | key or session                | `CatalogModel`                              |
| `POST /v1/models`, `PUT`/`PATCH`/`DELETE /v1/models/{model}`                               | session                       | model payload                               |
| `GET /v1/models/pricing`                                                                   | key or session                | `PricingListResponse`                       |
| `GET /v1/providers`                                                                        | key or session                | `ProviderListResponse`                      |
| `GET /v1/providers/catalog`                                                                | key or session                | `CatalogResponse`                           |
| `GET /v1/providers/{provider_id}`                                                          | key or session                | `ProviderEntry`                             |
| `PATCH /v1/providers/{provider_id}`                                                        | session                       | provider payload                            |
| `PATCH /v1/providers/{provider_id}/round-robin`                                            | session                       | provider payload                            |
| `POST /v1/providers`, `POST /v1/providers/verify`, `POST /v1/providers/connections/verify` | session                       | verification result                         |
| `DELETE /v1/providers/{provider_id}`                                                       | session                       | —                                           |
| `GET /v1/quota`                                                                            | key or session                | `QuotaResponse`                             |
| `GET /v1/logs`                                                                             | key or session                | `LogsResponse`                              |
| `GET /v1/logs/{id}`                                                                        | key or session                | `RequestLog`                                |
| `GET /v1/logs/stats`                                                                       | key or session                | `UsageStatsReport`                          |
| `GET /v1/logs/analytics`                                                                   | key or session                | `AnalyticsReport`                           |
| `GET /v1/logs/events`                                                                      | key or session                | SSE stream of `LiveEvent`                   |
| `GET /v1/settings`                                                                         | key or session                | `SettingsResponse`                          |
| `PATCH` or `POST /v1/settings`                                                             | session                       | `SettingsResponse`                          |
| `GET /v1/admin/database/export`, `POST /v1/admin/database/import`                          | session                       | multipart file                              |
| `POST /v1/chat` \| `/v1/chat/completions` \| `/v1/messages` \| `/v1/images/generations`    | key or session (rate limited) | chat/SSE/JSON                               |

`/v1/qouta` is a live typo alias of `/v1/quota` — keep using `/v1/quota`.

## Wire types

`src/api/types.ts` re-exports `../generated/typed`; that file is rendered from the Rust types by specta. Import from `@/api/types`, never from the generated path directly.

53 types are exported today, including `AdminStatus`, `APIKeyResponse`, `CreatedAPIKeyResponse`, `KeyListResponse`, `CatalogModel`, `ModelListResponse`, `PricingListResponse`, `QuotaResponse`, `ProviderEntry`, `ProviderListResponse`, `ProviderConnectionView`, `LogsResponse`, `RequestLog`, `UsageStatsReport`, `AnalyticsReport`, `AnalyticsBucket`, `LiveEvent`, `SettingsResponse`, and the error envelope.

**A shape you need but cannot find does not exist yet.** Add it in `server/src` with `#[derive(Serialize, specta::Type)]`, keep optional fields paired (`#[serde(skip_serializing_if = "...")]` with `#[specta(optional)]`), then:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts
```

That writes **both** `server/bindings.ts` and `client/src/generated/typed.ts`; commit both. `server/tests/bindings.rs` fails on drift.

## Server-Sent Events

`GET /v1/logs/events` streams `LiveEvent`, a discriminated union:

```ts
type LiveEvent =
  | { type: "connected" }
  | { type: "usage.updated"; stats: UsageStatsReport }
  | { type: "request.logged"; log: RequestLog }
```

**No client consumer exists yet** — nothing in `client/src` opens an `EventSource`. If you build one: `EventSource` cannot carry custom headers, so it relies on the session cookie exactly like `request`, and the server holds at most 16 concurrent streams with a 25-second heartbeat (a silent gap is not necessarily a dead stream). Prefer it over polling for live dashboards; the gateway's own chat streaming is unrelated to this and is not consumed by the dashboard.
