# Provider Drivers

A driver owns one upstream protocol end to end: how it authenticates, how a model id maps onto its catalog, and how a chat request becomes a response or a stream of SSE bytes.

## The contract

`ProviderExecutor` (`features/providers/executor.rs`) — all methods return `BoxFuture` instead of `async fn`, because native `async fn` in a trait is not dyn-compatible and the registry stores `dyn` objects.

Required:

| Method                                                                       | Purpose                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `as_any() -> &dyn Any`                                                       | lets the registry recover the concrete driver for its endpoint accessors; every impl is a one-liner |
| `id() -> &str`                                                               | the registered base id                                                                              |
| `keys() -> &'static [&'static str]`                                          | lookup keys (base id + aliases); a runtime driver returns `&[]` and overrides `keys_owned`          |
| `alias() -> &str`                                                            | the user-facing model prefix                                                                        |
| `models() -> Vec<String>`                                                    | advertised model ids — a `Vec` because a catalog can change at runtime                              |
| `chat_completion(model, request) -> Result<Value, APIError>`                 | buffered call; returns the upstream body                                                            |
| `chat_completion_stream(model, request) -> Result<ProviderStream, APIError>` | streaming call; `Err` only before the first byte                                                    |

With defaults (override only when needed): `keys_owned` (owned keys for runtime drivers), `model_id_variants` (every bare id naming the same model; only a live catalog has several), `maybe_refresh(force)` (catalog refresh), `sweep_tokens()` (OAuth refresh), `generate_image` (defaults to a `400 model_not_supported`).

`ProviderStream = Pin<Box<dyn Stream<Item = Bytes> + Send>>` — **infallible**. Failures arrive as SSE error events, so a stream `Err` is a contract violation.

`ProviderAdapter(Arc<dyn ProviderExecutor>)` is a cheap-clone handle over the trait object. The registry stores one clone per lookup key, which is why the adapter exists and why per-provider state (refresh locks, rotators) must be `Arc` inside the driver.

## Per-vendor file set

The canonical layout is documented in `antigravity/mod.rs` and `claude/mod.rs`:

| File           | Responsibility                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `mod.rs`       | submodule declarations, `#[cfg(test)] mod tests`, re-exports                                                                         |
| `types.rs`     | `<VENDOR>_PROVIDER: ProviderMetadata`, `<VENDOR>_KEYS`, `<Vendor>Endpoints` (+ `Default` so tests can inject a fake)                 |
| `executor.rs`  | the driver struct, its inherent helpers, `impl ProviderExecutor`, and `pub fn adapter(db)` / `adapter_with_endpoints(endpoints, db)` |
| `auth.rs`      | credential load, account picking, `ensure_fresh_token`                                                                               |
| `request.rs`   | body + header builder (`PreparedRequest`)                                                                                            |
| `translate.rs` | upstream ⇒ OpenAI chunk translation, usually `XxxDecoder` + `Aggregator`                                                             |
| `catalog.rs`   | `SharedCatalog`, TTL/retry policy, parse, poison-safe read/write                                                                     |
| `refresh.rs`   | `maybe_refresh` policy and the coalesced fetch                                                                                       |
| `quota.rs`     | live quota read (only `codex` today)                                                                                                 |
| `tests.rs`     | unit tests for translation/request building                                                                                          |

Not every vendor has every file — copy the closest existing driver rather than inventing a shape:

| Vendor                 | Files                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `qoder/`               | full set + `cosy.rs` (request signing), `state.rs`                                               |
| `cline/`, `codebuddy/` | full set (+ `product.rs` for CodeBuddy)                                                          |
| `codex/`               | full set + `quota.rs`                                                                            |
| `antigravity/`         | full set minus `catalog.rs` (its catalog is static, flipped by `refresh.rs`)                     |
| `grok_web/`            | `auth`, `transport` (WebSocket), `request`, `translate`, `types`, `executor`, `tests`            |
| `claude/`              | only `executor`, `catalog`, `types` — translation comes from the shared `providers/anthropic.rs` |
| `opencode/`            | `executor`, `types`, `tests` + `tools.json`/`harness.txt` prompt payloads                        |
| `custom/`              | one generic driver per DB row: `executor`, `registry`, `catalog`, `mod`                          |

Shared instead of copied per vendor: `providers/adapter.rs` (`OpenAIAdapter`, `encode_stream`, `upstream_*` error helpers), `providers/anthropic.rs` (Messages-protocol translation), `providers/wire.rs` (header/hex/usage helpers), `providers/rotation.rs`, `providers/quota.rs`, `providers/model.rs`.

## Registration

`ProviderRegistry` (`registry.rs`) = `RwLock<HashMap<String, ProviderAdapter>>` keyed by **every lowercased lookup key** (so one provider appears 1–3 times) + `Mutex<HashMap<String, usize>>` for round-robin indices.

- `with_database(Some(db))` registers the 9 built-ins in catalog order: opencode, qoder, cline, grok_web, codebuddy (Global), codebuddy (China), antigravity, claude, codex. `with_defaults()` = `with_database(None)`; without a database the OAuth drivers advertise no model at all.
- `register(&mut self, …)` is for boot, before the registry is shared. `register_runtime(&self, …)` needs no `&mut self` and is how a custom provider created over HTTP joins a registry other requests are already reading.
- `unregister(base_id)` drops every key of that provider — skipping it after a delete leaves the models resolving until restart.
- **`SEED_PROVIDERS` (`providers/mod.rs`) is not used for registration.** It feeds the `/v1/providers` listing and catalog order, so a driver with no connection still appears on the Providers page.
- Custom providers live in `providers` rows: `register_custom_providers` at boot, `refresh_custom_provider` after a write, `unregister_custom_provider` after a delete (`custom/registry.rs`).

## Model resolution

`resolve(model)` (`registry.rs`):

1. `<prefix>/<bare>` → look the prefix up in the key map (no lowercasing at this step — the map is already lowercase) and return the bare remainder. A model id containing further slashes keeps them (`cline/anthropic/claude-…`).
2. No slash → filter every adapter whose `models()` contains the id, or, when the id contains a `.`, its dotted-free form (`gpt-6.luna` matches `gpt-6-luna`).
3. One match → that one. Several → round-robin via `selection_indices`, which lives behind an `Arc<Mutex>` so clones of the registry share the rotation.

`model_id_variants(requested)` prefixes the alias and returns every name of that model — used by the API-key allowlist (`api_keys/access.rs`), the catalog, and the gateway, so hiding a model by one name hides all of them.

Each driver strips its own prefix from the bare id (`strip_cline_prefix`, `strip_codex_prefix`, `strip_provider_prefix`) — do not strip in the registry.

## Rotation and failover

Two different layers, often confused:

- **Provider selection** — `selection_indices`, for a bare model id served by several providers.
- **Account rotation** — `AccountRotator` (`providers/rotation.rs`), for one provider with several connections.

`AccountRotator::choose(enabled, connection_ids)` walks a newest-first list, skips rows inside their cooldown, and returns the newest when every row is cooling (serving the request beats waiting). `cool(id)` sets a fixed 60 s deadline — fixed rather than `Retry-After`, because recovering from a 429 is availability, not fairness. `round_robin_enabled` reads the setting `round_robin_<base_id>`; a missing row means **on** (a deliberate deviation from Node, which defaulted off).

Failover loops (`qoder`, `cline`, `grok_web`, `codex`) retry the next account when `is_rate_limited(error)` — which string-matches `"(429)"` in the flattened upstream message. That coupling is why adapters must build that message through the `upstream_*` helpers; a vendor that formats its own status will never trigger cooldown. Failover covers only the phase before the first byte; a mid-stream failure goes to the client as an SSE error event.

## Catalogs, tokens, quota

- `maybe_refresh(force)` gate: if the driver has credentials, await a coalesced fetch when its catalog is empty, or spawn a background refresh when it is filled and stale. TTL is 5 minutes with a 30 s retry window for an unfilled snapshot. `maybe_refresh_catalogs` is called on boot (warm-up), on a failed resolve in the gateway, on catalog reads carrying a refresh hint, and with `force = true` after a successful OAuth login.
- The refresh lock must be `Arc<tokio::sync::Mutex<()>>` held on the driver, because the registry stores one clone per key — without it you get a fetch burst.
- `sweep_tokens()` is called by a background task after 5 s, then every 60 s, with a 5-minute lead before expiry and a fallback (12 h for Cline, 1 day for Codex) when the token carries no expiry. `sweep_tokens` iterates deduplicated providers — use `id()` to dedup, not the raw map iteration.
- Only `openai_codex` has a live quota fetcher; the other OAuth providers are omitted from `/v1/quota` rather than reported as zero.

## Adding a provider

1. Create `providers/<vendor>/` with `mod.rs`, `types.rs` (`ProviderMetadata`, `*Endpoints`), `executor.rs` (driver + `impl ProviderExecutor` + `adapter()`/`adapter_with_endpoints()`), adding `auth`/`request`/`translate`/`catalog`/`refresh`/`tests` as the protocol needs. Copy the closest existing driver.
2. Declare the module and re-export `<VENDOR>_KEYS`/`<VENDOR>_PROVIDER` in `providers/mod.rs`, and add the metadata to `SEED_PROVIDERS` (its position sets catalog order).
3. Register it in `ProviderRegistry::with_database` — or, for a DB-row provider, follow `custom/registry.rs` with `register_runtime`/`unregister`.
4. Reuse `adapter.rs` for an OpenAI-shaped upstream, or `anthropic.rs` for a Messages-shaped one; wrap the stream through `encode_stream` so stalls and failures become error events.
5. Credentials: add `infrastructure/database/providers/credentials/<vendor>.rs` with `load_*_credentials` / `upsert_*_connection` / `update_*_tokens`, and export it from `credentials/mod.rs`.
6. OAuth: add `features/provider_auth/<vendor>.rs`, re-export the routers from `provider_auth/mod.rs`, mount logins with `require_admin_session` and callbacks unguarded in `app.rs`, and call `maybe_refresh_catalogs(true)` in the callback.
7. Messages: every new string goes into `constants.rs` under `providers` or a per-driver submodule.
8. Tests: unit tests in `providers/<vendor>/tests.rs`, an integration suite `server/tests/<vendor>_provider.rs` with a fake upstream in `tests/support/mod.rs` (`Fake<Vendor>Upstream`, `connect_<vendor>`, `<vendor>_registry`, `<vendor>_state`), plus `<vendor>_auth.rs` when OAuth exists. Check `server/tests/providers.rs` and `models.rs` when the catalog changes.

## Traps

- **`features/gateway/adapter.rs` does not exist** — the driver contract is `features/providers/adapter.rs`.
- Override `keys_owned` whenever the id is not `'static`; a driver whose `keys()` returns `&[]` without it registers **no** lookup key and can never resolve.
- The registry stores one adapter clone per lookup key: any "run once per provider" loop must dedup on `id()`.
- `resolve` does not lowercase the prefix while the map is lowercase — an uppercase prefix silently fails to resolve.
- Adapters flatten an upstream status into a `500 … Error (<status>)` message; auth/rotation logic that matches on that string must use the shared `upstream_*` helpers.
- Every `translate_stream` must handle three cases: end of upstream (emit `[DONE]` if the protocol needs it), transport error, and the 120 s idle stall. Missing one leaves a hanging stream.
- `ProviderStream` can only carry `Bytes` — errors must be SSE events, so a test expecting a stream `Err` is testing the wrong contract.
- `round_robin_enabled` defaults to **true**; do not "fix" it to match the Node default.
- A custom provider's model ids and prefix come from its DB row — re-register after every write, or the catalog keeps serving the old shape.
