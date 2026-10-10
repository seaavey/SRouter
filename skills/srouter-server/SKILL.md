---
name: srouter-server
description: Use when editing `server/` — the SRouter Rust crate (axum 0.8, tokio, sqlx/SQLite, specta). Covers HTTP routes and router layering, middleware, `APIError` and `constants.rs` wire copy, provider drivers and registries, SQLite stores and migrations, SSE streaming, and the integration test harness. Trigger on changes under `server/src`, `server/tests`, or `server/migrations`, or when a task mentions a provider, executor, gateway route, or upstream.
version: 1.0.0
author: Muhammad Adriansyah (Seaavey)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [srouter, rust, axum, tokio, sqlx, llm-gateway, sqlite]
    related_skills: [srouter-frontend, golang-code-style]
---

# SRouter Server

Work inside `server/`. One Rust crate (`srouter-server`) that is the whole product: an OpenAI/Anthropic-compatible LLM gateway plus its operator API.

**The contract is the Rust types and the route tests.** Comments citing `docs/api-v1-contract.md` or `docs/schemas-database.md` point at files that no longer exist — those contracts now live in the types, `constants.rs`, and `server/tests/`.

## When to Use

- Anything under `server/src`, `server/tests`, or `server/migrations`.
- Adding or fixing a route, a middleware, a provider driver, a store, or a migration.
- Anything that changes a JSON wire shape — that also changes `client/`, via the generated bindings.
- Not for dashboard code: `client/` has its own skill, `skills/srouter-frontend/`.

## Non-negotiables

1. **Every client-visible string, code, and header name comes from `constants.rs`.** Never inline a message in a handler; messages that interpolate become functions. Codes are the `ErrorCode` enum (not string constants), so `with_code` takes a variant and the client receives a closed union plus a same-named const object (`ErrorCode.InvalidJson`'s mirror) to compare against at runtime.
2. **Wire fields are `snake_case` — always, on both directions.** All 238 fields rendered into `client/src/generated/typed.ts` are snake_case, and the client depends on it (`key_prefix`, `setup_required`, `allowed_models`). See [Wire field casing](#wire-field-casing) before naming a field.
3. **One error type.** `APIError` with builders, propagated by `?`. No `anyhow`, `thiserror`, or per-module error enums.
4. **No `unwrap()` on a production path.** Lock poisoning is recovered, not unwrapped: `.unwrap_or_else(|e| e.into_inner())`.
5. **`ProviderStream` never yields `Err`.** A stalled or failed upstream ends the stream with an in-stream SSE error event.
6. **Guards are per-mount, and layer order is load-bearing.** Read the router section of `references/http-layer.md` before touching `app.rs`.
7. **Generated files are output.** `server/bindings.ts` is written by `export_ts`; a wire-type change means regenerating and committing it alongside the client copy.

## Wire field casing

Rust field names and JSON field names must be the same thing: `snake_case`, never camelCase.

```rust
// correct — the Rust name is the wire name
pub struct CreatedAPIKeyResponse { pub key: String, pub key_prefix: String }

// never — a camelCase wire name breaks the client contract
#[serde(rename = "keyPrefix")]     // do not add this
pub key_prefix: String,
```

The whole served surface holds this: `CreatedAPIKeyResponse`, `APIKeyResponse`, `AdminStatus`, `AnalyticsReport`, `RequestLog`, `ProviderEntry`, `ModelPricingItem`, and the rest — 57 exported types, 238 fields, zero camelCase. Request bodies read by hand follow the same spelling (`object.get("allowed_models")`, `custom_headers`, `credit_limit`).

Rules that follow from it:

- **No `#[serde(rename_all = "camelCase")]`.** Do not add a per-struct or crate-wide rename to "modernise" the API, and do not add `#[serde(rename)]` on a field merely to change its case.
- **`#[serde(rename)]` is for a name that is not a valid Rust identifier**, not for style. The two legitimate cases in this crate: `error.type` (a reserved word) and the kebab/dotted tag values in `protocol/sse.rs` (`rename_all = "kebab-case"`, `usage.updated`).
- **Enum _values_ are a separate decision** and are not snake_case by default — they mirror what the protocol already ships: `"UPPERCASE"` for `HTTPMethod`, `"lowercase"` for `ObjectKind` and the provider protocols, `"kebab-case"` for SSE event tags. Match the existing enum in your area rather than inventing a case.
- **A new type is a wire contract.** Fields nobody asked about are not free: adding one changes `bindings.ts` and the client, so add only what the endpoint needs.
- **Request bodies are wire contracts too.** A handler that reads a JSON body by hand (`parse_setup`, `parse_create_input`) still declares the shape it accepts as a `specta::Type` struct and returns it from the parser, so the client's `request<T>()` argument is generated rather than re-declared. A body type carrying a secret derives no `Debug`/`PartialEq`.

Before committing a wire change:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts   # rewrites both committed copies
git diff -- client/src/generated/typed.ts                     # every added field must read snake_case
```

If the diff shows a camelCase field, the fix belongs in the Rust type — never in the generated file.

## Workflow

1. Read `references/architecture.md` for boot order, module layout, and where a change belongs.
2. Pick the reference that matches the work:
   - routes, middleware, error envelopes, streaming → `references/http-layer.md`
   - provider drivers, model resolution, rotation, catalogs → `references/providers.md`
   - stores, migrations, upstream/SSRF, logging → `references/database.md`
   - harness, isolation, contract suites → `references/testing.md`
3. Implement, matching the module you are in.
4. Verify: `cargo fmt --check`, `cargo clippy --all-targets --all-features --locked -- -D warnings`, then the specific suite — and exercise the real path.

## Verification

```bash
cargo test --manifest-path server/Cargo.toml --test chat_completions   # one suite
cargo test --manifest-path server/Cargo.toml --locked                  # everything
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo run --manifest-path server/Cargo.toml                            # run it, cwd server/ for .env
cargo run --manifest-path server/Cargo.toml --bin export_ts            # after any wire-type change
```

A green `cargo check` proves nothing about behaviour. For a route, call it against a running server; for a provider, run its suite plus a real gateway request; for a migration, boot against a database at the previous version.

There is no CI — the full suite is a manual pre-push obligation.

## Rules that keep diffs small

- **Reuse the vocabulary.** `APIError` + `constants.rs`, `create_*_router`, the `TestDatabase` harness, `ProviderAdapter`/`ProviderExecutor`, `upstream::UpstreamClient`. A second convention for a job that already has one is the defect.
- **Acronyms stay capitalised: `APIError`, `APIKey`, `HTTPMethod`, `OAuthSession`, `SQLxAPIKeyStore`.** This is the house style across the crate, not `ApiError`/`HttpMethod` as upstream Rust guidance would suggest — `clippy` does not flag it here, and the generated `typed.ts` carries the name through verbatim, so renaming one type changes a wire-visible identifier. Match the neighbours rather than the style guide.
- **Five traits exist in the whole crate.** Do not add another abstraction, generic, or registry until a second concrete caller exists.
- **Match the file.** Read the surrounding lines before adding to a module; the naming and comment style in this crate are deliberate.
- **`//!` comments explain why and cite the Node oracle** (`apps/api/src/...:line`). Match that; do not narrate what the next line does.
- **A rename lands every callsite in the same diff.** No shims or re-exports.

## References

| File                                                       | Read it for                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`references/architecture.md`](references/architecture.md) | Boot order, module map, request path, layer boundaries                            |
| [`references/http-layer.md`](references/http-layer.md)     | Router mounts and guards, middleware patterns, `APIError`, SSE, request helpers   |
| [`references/providers.md`](references/providers.md)       | Driver contract, per-vendor file set, registration, rotation, new-provider recipe |
| [`references/database.md`](references/database.md)         | `AppDatabase`, store patterns, migrations, upstream client, SSRF, telemetry       |
| [`references/testing.md`](references/testing.md)           | Harness helpers, isolation rules, which suite pins which contract                 |
