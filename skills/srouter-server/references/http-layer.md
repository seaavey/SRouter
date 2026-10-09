# HTTP Layer

## Router

`create_router(state)` in `server/src/app.rs` is the only assembly point. Each feature exposes a `create_*_router()` returning `Router<AppState>`; the composition root decides the guard.

| Mount                                                                                                                    | Guard                         | Note                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| gateway (`/chat`, `/chat/completions`, `/chat/completion`, `/messages`, `/messages/count_tokens`, `/images/generations`) | `rate_limit` + `api_key_auth` | rate limit added **before** auth ⇒ auth is outermost and runs first, so the limiter can read `APIPrincipal` |
| models read (`/models`, `/models/{*model}`)                                                                              | `api_key_auth`                | **skips the limiter**: catalog polling must not consume the chat window                                     |
| models write                                                                                                             | `require_admin_session`       |                                                                                                             |
| `/keys`, `/keys/{id}`, `/keys/{id}/credit`                                                                               | `require_admin_session`       |                                                                                                             |
| providers read (`/providers`, `/providers/catalog`, `/providers/{id}`)                                                   | `api_key_auth`                | read surface                                                                                                |
| providers mgmt (`PATCH`, `round-robin`)                                                                                  | `require_admin_session`       |                                                                                                             |
| custom providers (`POST /providers`, `/providers/verify`, `/providers/connections/verify`, `DELETE /providers/{id}`)     | `require_admin_session`       |                                                                                                             |
| provider logins (`/auth/*` device flows)                                                                                 | `require_admin_session`       |                                                                                                             |
| provider callbacks (JSON)                                                                                                | none                          | the browser lands on them without a session                                                                 |
| callback **pages** (`/auth/callback`, `/auth/qoder/callback`, …)                                                         | `body_limit` only             | root mounts, outside `/v1` — the vendor pins the URL                                                        |
| logs, quota, pricing, settings read                                                                                      | `api_key_auth`                |                                                                                                             |
| settings mgmt, `/admin/database/*`                                                                                       | `require_admin_session`       |                                                                                                             |
| admin auth (`/admin/status`, `setup`, `login`, `logout`, `change-password`)                                              | none                          | session enforced **per handler**                                                                            |

Then: `merge` everything → `.fallback(route_not_found)` → `.layer(csrf_origin_guard)` → `.layer(body_limit)`, and `.nest("/v1", …)` plus `.nest("/v1/v1", …)` for the compatibility alias (gateway + models only). Root: `/v1` api-info, `/health`, the callback-page merges, and — when `resolve_web_dist` finds a dist — a `serve_static` fallback, else `/` returns api-info.

**Global layers, in file order (last added = outermost):**

```text
.layer(cors)                  innermost
.layer(security_headers)
.layer(log_failed_requests)
.layer(log_access)            outermost
.with_state(state)
```

Order rules that break things when ignored:

- `Router::layer` only wraps routes that already exist → root route and SPA fallback are registered **before** the layers.
- The nest's `body_limit`/`csrf` wrap every inner mount, so a per-mount guard runs **after** them.
- `rate_limit` silently no-ops without `api_key_auth` upstream of it (it reads the `APIPrincipal` extension).

## Writing a middleware

```rust
// stateless
pub async fn security_headers(request: Request, next: Next) -> Response { … }

// carries state (preferred when you need AppState)
pub async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response { … }
```

Register it in `http/middleware/mod.rs` first, then attach it either per-mount (`app.rs`, `from_fn_with_state(state.clone(), …)`) or globally.

Rules:

- Take `mut request` if you need to inject: `request.extensions_mut().insert(principal)` (what `api_key_auth` does).
- Read an earlier layer's work with `request.extensions().get::<APIPrincipal>()`.
- Return rejections through the error type: `error.into_response()`, or `APIError::new(429, constants::…).with_error_type(…).into_response()`.
- Never panic on malformed input — a middleware runs before the handler and its panic is a 500 with no envelope.

Two representative files to copy from: `api_key_auth.rs` (stateful, injects, reads a cookie and two header forms) and `security_headers.rs` (stateless, rewrites the response).

## Errors

One type, `APIError` (`src/error.rs`): `{ status, message, error_type, code, param }` with builders `new`, `with_error_type`, `with_code`, `with_param`, and `impl IntoResponse`.

- `error.type` is derived from the status unless overridden: `400|404|409|422 → invalid_request_error`, `401 → authentication_error`, `403 → permission_error`, `429 → rate_limit_error`, otherwise `api_error`.
- `IntoResponse` logs 5xx with `tracing::error!` and answers the JSON envelope; an unrepresentable status falls back to 500.
- The envelope is `ErrorEnvelope { error: { message, type, code?, param? } }`; `code`/`param` are skipped when `None`.
- `invalid_json()` is the shared 400 for a malformed body — its single production caller is the body reader (`gateway/interception/body.rs`). Do not invent a per-handler variant.
- `constants::error_type::*` exists only for deliberate overrides; `constants::code::*` are the stable machine ids clients branch on.

## Handlers

Extractors in use: `State<AppState>`, `Option<Extension<APIPrincipal>>` (optional on admin mounts that carry no API-key guard), `Path`, `Query`, `RawQuery`, `HeaderMap`, router-injected `Extension<SomeEndpoints>`, raw `Bytes` for small admin writes, and raw `Request` for the gateway because the body is read by hand.

**Reading a JSON body:** use `read_json_body(request)` (`gateway/interception/body.rs`), never `Json<T>` directly on the gateway. It pre-checks `Content-Length` against `MAX_BODY_BYTES` (25 MiB), then `to_bytes(.., MAX_BODY_BYTES)` so a lying chunked request is still capped, validates UTF-8, rejects an empty body, and parses. Its `BodyError` maps to the OpenAI envelope or the Anthropic one depending on the route. `http/middleware/body_limit.rs` is a cheap Content-Length pre-check only — the real cap is the reader.

**Returning:** `Ok(Json(value).into_response())` for JSON, `Err(APIError)` to let `IntoResponse` build the envelope, `sse::sse_response(…)` for a stream.

## Streaming (SSE)

```text
driver chat_completion_stream() → ProviderStream (Bytes)
  → gateway spawns a loop, pushes into tokio::sync::mpsc(64)
  → ReceiverStream → sse::sse_response(stream, version)
```

- `sse_response` sets `text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, plus `Connection: keep-alive` for HTTP/1.x only.
- **`ProviderStream` is infallible** (`Item = Bytes`). A transport failure or a 120 s stall becomes one `data: {envelope}\n\n` record via `sse::error_event_bytes`, and the stream then ends. Never return `Err` from a stream.
- `STREAM_IDLE_TIMEOUT = 120 s` (`infrastructure/upstream/client.rs`). `encode_stream` in `providers/adapter.rs` is the reference implementation of the timeout/error/`None` triad — every vendor `translate.rs` repeats that triad, and missing the `Ok(None)` arm leaves a stream hanging without `[DONE]`.
- Client disconnect: the loop races `tokio::select! { biased; _ = tx.closed() => …, next = stream.next() => … }`. Dropping the receiver cancels the upstream request and logs partial usage.
- `SseDataDecoder` (`protocol/sse.rs`) buffers partial lines and drops non-`data:`, empty, `[DONE]`, and non-JSON lines.

## Constants

`constants.rs` is organised as modules: `code`, `error_type`, `headers::{name,value}`, `json`, `common`, `admin`, `api_key`, `keys`, `middleware`, `gateway` (+ `schema`, `anthropic`), `providers` (+ `favorites`, `oauth`, per-driver), `settings`, `logs`, `database` (+ `context`), `upstream`.

Constants hold literal strings. Messages that interpolate are **functions** with typed arguments (`format!` needs a literal): `api_key::model_not_allowed(model)`, `middleware::rate_limit_exceeded(limit)`, `gateway::model_not_registered(model)`, `providers::upstream_stalled(seconds)`.

## Request helpers

`src/request.rs`:

- `MAX_BODY_BYTES = 25 MiB` — the one body cap.
- `client_address(extensions)` reads **only** `ConnectInfo<SocketAddr>`. The Node build fell back to the `Host` header, which let a remote client claim localhost; the Rust listener always injects connect info, so the fallback is gone. Consequence: behind a reverse proxy, rate limiting keys on the proxy's address.
- `is_loopback_address` lowercases, strips one `::ffff:` prefix, then requires exactly `127.0.0.1` or `::1`.
- `cookie_value` joins duplicate `Cookie` headers, splits on `;`, trims, and matches the name exactly (quotes kept).

## Observability middleware

- `security_headers` overwrites six response headers — `x-powered-by`, `x-version` (= `CARGO_PKG_VERSION`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`. A handler's own values get overwritten.
- `log_access` is a no-op unless `config.access_log` (off in production unless `SROUTER_ACCESS_LOG`). It captures bodies up to 64 KiB, redacts JSON fields, masks `Bearer`/`sk-` values and sensitive query names, and prints a sorted header summary.
- `log_failed_requests` logs 5xx at `error!` and 4xx at `warn!`, with no query string.
- `rate_limit` is a fixed 60 s window keyed `{api_key_id}:{address}`, answers `429` with `Retry-After`, treats `rate_limit == 0` as unlimited, and caps tracked windows at 10 000 with expiry-only eviction.
