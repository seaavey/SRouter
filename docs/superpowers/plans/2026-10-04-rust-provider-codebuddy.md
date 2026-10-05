# CodeBuddy Provider (OAuth + live catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the CodeBuddy inference executor to the Rust gateway (`server/`): both the global (`codebuddy`) and China (`codebuddy-cn`) flavors serve `/v1/chat/completions` (stream + non-stream aggregation), and advertise models read live from the CodeBuddy product configuration instead of a hardcoded list.

**Architecture:** One provider module (`features/providers/codebuddy/`) owning the protocol constants, the live catalog snapshot, and the executor, parameterized by a `Flavor { Global, China }` enum so the wire behavior is written once and only the endpoints, headers, and registry identity differ. The executor reads its connection from the `providers` row at request time (the same static-registry pattern Cline/Codex established) and holds the catalog in a shared `Arc<RwLock<..>>`. No new table, no migration: `providers.credentials` and `oauth_sessions` already exist, and the OAuth routes shipped earlier.

**Tech Stack:** Rust edition 2024 (stable), axum 0.8, sqlx 0.9 (SQLite), reqwest 0.13 (rustls), serde/serde_json, tokio 1. No new crates.

**Spec / provenance:** `apps/api` + `packages/executors/src/codebuddy.ts` (behavioural oracle), the reverse-engineering notes at `~/Projects/SRouter/.local/codebuddy-reverse-engineering.md` (official binary `@tencent-ai/codebuddy-code` 2.161.2), and live probes on 2026-10-04.

---

## Analisis CodeBuddy (independent protocol analysis)

Sources, recorded here for `server/TODO.md` §4 "Catalog provenance":

1. Reverse engineering of the official client `@tencent-ai/codebuddy-code` v2.161.2 (`dist/codebuddy.js`, `dist-server/codebuddy.js`, transport chunk `dist-server/3163.codebuddy.js`). Full notes in `~/Projects/SRouter/.local/codebuddy-reverse-engineering.md`.
2. Live probes without credentials on 2026-10-04: the product-config endpoint is `GET {base}/v3/config` (HTTP 200). `/v2/config`, `/config/models`, `/v2/plugin/config`, and `/v2/models` are all `404`.
3. `apps/api` + `packages/executors/src/codebuddy.ts` (allowed oracle): header set, body transform, stream accumulation.
4. `packages/constants/src/providers/codebuddy.ts`: provider metadata, origins, user agents (the model list there is stale and is deliberately not used).

### Endpoints used by this slice

| Purpose              | URL (global)                                 | URL (China)                                    |
| -------------------- | -------------------------------------------- | ---------------------------------------------- |
| Chat                 | `POST https://www.codebuddy.ai/v2/chat/completions` | `POST https://copilot.tencent.com/v2/chat/completions` |
| Model configuration  | `GET https://www.codebuddy.ai/v3/config`     | `GET https://copilot.tencent.com/v3/config`    |

The `X-Domain` header is set for the China flavor only (`www.codebuddy.cn`); the global flavor sends none.

### Live model catalog

CodeBuddy has no `/models` endpoint. The client recognizes a product-configuration request by `/\/(?:v[123]\/config|config\/(?:models|agents))\/?$/` and takes `data.models[]` as the catalog. The unauthenticated `GET /v3/config` answers `200` with `{"code":0,"msg":"OK","data":{"agent":{"agents":null},"models":null,...}}`.

**Confirmed by an authenticated live probe (2026-10-04, personal account):** `GET /v3/config` with a real Bearer token returns `{enterpriseId, productFeatures, productFeaturesConfig}` and **no `models`**. The client's `CloudProductProvider` only merges a cloud `models` array when one is present; the personal-account catalog is the bundled `product.json`. No client API lists models (`/v1/traces`, `/v2/accounts`, `/v2/auth/token/refresh`, `/v3/config` only). `fetch_catalog` therefore parses `data.models[].id` when present and leaves the catalog empty otherwise. **No hardcoded fallback list** — the owner chose live-only on 2026-10-04, so a personal account advertises no `codebuddy/*` model while chat still works by explicit id (`codebuddy/deepseek-v4.1-flash`).

### Wire behavior (from the Node oracle)

- `stream: true` is forced: upstream is stream-only.
- Header set: `Content-Type`, `User-Agent` (per flavor), `X-Product: SaaS`, `X-IDE-Type`/`X-IDE-Name` (`IDE` global, `CLI` China), `x-requested-with: XMLHttpRequest`, `x-codebuddy-request: 1`, `X-Domain` (China only), `Authorization: Bearer <token>`.
- `reasoning_effort` of `"none"`/`"off"` is dropped; any other value adds `reasoning_summary: "auto"`.
- A leading `"You are CodeBuddy Code."` system prompt is prepended; caller system/developer turns are appended to it.
- A user string becomes a typed block `[{type:"text",text}]`.
- `response_format` is dropped and mirrored into the last user turn (schema for `json_schema`, a plain directive for `json_object`).
- Streaming is line-based and accepts both `data: {...}` framing and raw NDJSON; malformed JSON is skipped.
- Non-streaming runs the stream and aggregates: `content`, `reasoning_content`, per-index `tool_calls` (no `index` in the output), last non-null `finish_reason` (fallback `"stop"`), and the last `usage` seen. `content || reasoning || null`.

---

## Decisions

- **D1: Follow the SRouter Node oracle for wire behavior.** Minimal header set, forced `stream:true`, `"You are CodeBuddy Code."`, `response_format` → user-turn directive. The real client sends a header superset and never injects that system prompt; the module doc records this.
- **D2: One executor, two flavors.** `CodeBuddyExecutor` parameterized by `Flavor { Global, China }`; two adapters registered.
- **D3: Models gated on the exact connection.** `provider_id = "codebuddy"` vs `"codebuddy-cn"`; `matches_base_id` cannot distinguish them, so the check is exact.
- **D4: Live catalog, no seed.** A shared snapshot with TTL 5 min / retry window 30 s / coalesced refresh; a failed fetch leaves the catalog empty (no hardcoded fallback).
- **D5: Streaming is re-framed.** Each upstream chunk becomes `data: {...}\n\n` and the stream ends with exactly one `data: [DONE]\n\n` (the Rust gateway does not add `[DONE]`, unlike Node).
- **D6: No token refresh, no 401 retry.** The login token is valid ~1 year; an expired token surfaces as an upstream error and the operator reconnects.
- **D7: Static chat endpoints per flavor.** The per-connection `base_url` is not honored (same simplification as Cline/Codex Rust); documented deviation.
- **D8: `finish_reason` = last non-null, fallback `"stop"`; `tool_calls` omit `index`; `usage` present only when upstream sent it.**
- **D9: No dot/dash model canonicalization.** The registry strips the prefix; the bare id goes upstream.

## File Structure

| File                                                     | Responsibility                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `server/src/features/providers/codebuddy/mod.rs`         | module wiring + re-exports                                                                  |
| `server/src/features/providers/codebuddy/types.rs`       | endpoints, UA constants, `ProviderMetadata`, `Flavor`, provenance doc comment, unit tests   |
| `server/src/features/providers/codebuddy/catalog.rs`     | `CodeBuddyCatalog` snapshot, `parse_config`, TTL and retry-window helpers                    |
| `server/src/features/providers/codebuddy/executor.rs`    | credential load, live catalog fetch, body transform, stream and non-stream handling         |
| `server/src/features/providers/mod.rs`                   | modify: `pub mod codebuddy;` + re-exports, both metadata into `SEED_PROVIDERS`              |
| `server/src/features/providers/registry.rs`              | modify: register the two adapters                                                           |
| `server/src/infrastructure/database/providers.rs`        | modify: `CodeBuddyCredentials`, `load_codebuddy_credentials`                                |
| `server/src/constants.rs`                                | modify: `providers::codebuddy` messages (`NOT_CONNECTED`, `DATABASE_REQUIRED`)              |
| `server/tests/support/mod.rs`                            | modify: `FakeCodeBuddyUpstream` config + chat legs, `connect_codebuddy`, `codebuddy_registry`|
| `server/tests/codebuddy_provider.rs`                     | new: catalog gating, headers, body transform, streaming, aggregation, not-connected         |
| `server/TODO.md`                                         | modify: the CodeBuddy row of §5 now records the landed executor                             |

---

### Task 1: types and flavor

- [x] `types.rs`: `CODEBUDDY_CHAT_URL`/`CODEBUDDY_CONFIG_URL` (+ CN variants), UA constants, `CODEBUDDY_PROVIDER`/`CODEBUDDY_CN_PROVIDER`, `CodeBuddyEndpoints { chat_url, config_url, domain }` with `Default` and `cn()`, `enum Flavor { Global, China }`.
- [x] Module doc names the provenance sources.

### Task 2: live catalog

- [x] `catalog.rs`: `CodeBuddyCatalog { fetched_at_ms, attempted_at_ms, models }`, `shared_empty`, `parse_config` taking `data.models[].id`, `refresh_is_due` (TTL 5 min / retry 30 s), `read_catalog`/`write_catalog`.

### Task 3: credential load

- [x] `infrastructure/database/providers.rs`: `CodeBuddyCredentials { access_token }` and `load_codebuddy_credentials(db, provider_id)` (exact `provider_id`, `enabled = 1`, newest row, `access_token`/`accessToken` fallback).

### Task 4: executor

- [x] `CodeBuddyExecutor { flavor, endpoints, database, client, catalog, catalog_refresh_lock }`.
- [x] `models()` from the catalog; `maybe_refresh(force)` gated on the exact connection then fetches when due (coalesced).
- [x] `transform_body`: strip prefix; `stream: true`; reasoning handling; identity system prompt; typed user blocks; `response_format` → last-user directive.
- [x] Headers per flavor; `chat_completion` (stream + aggregate); `chat_completion_stream` (re-frame + one `[DONE]`); `adapter` / `adapter_with_endpoints`.

### Task 5: wiring

- [x] `mod.rs`, `registry.rs` (both flavors), `constants.rs`.

### Task 6: tests

- [x] `FakeCodeBuddyUpstream` config + chat legs; `connect_codebuddy`; `codebuddy_registry`.
- [x] `tests/codebuddy_provider.rs`: catalog gating + isolation, config failure, global/CN headers, body transform, NDJSON re-framing, fragmented reassembly, aggregation, mid-stream error, not-connected.

### Task 7: backlog sync and quality gates

- [x] `server/TODO.md` §5 CodeBuddy row updated.
- [x] `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` clean.
- [x] `cargo test --lib codebuddy` (25), `--test codebuddy_provider` (11), `--test codebuddy_auth` (5) all pass.
- [x] `--test providers` seed-count assertions moved from 5 to 7 (the two new seed entries).
- Note: `server/tests/providers.rs::the_compat_alias_does_not_serve_providers` and `::the_hidden_model_routes_are_gone` fail on the branch head before this slice and are unrelated to it (verified against a clean tree).

## Verification

```bash
cd /home/seaavey/Projects/SRouter/server
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --test codebuddy_provider --test codebuddy_auth
```

## Open questions for live verification

1. **Resolved (2026-10-04):** an authenticated personal account's `/v3/config` returns `productFeatures` only, no `models`, so the live catalog is empty and `/v1/models` advertises no CodeBuddy ids. Owner decision: keep live-only; use explicit model ids. Only an enterprise `console/enterprises/{id}/config/models` could supply a cloud `models` array.
2. Does upstream accept the minimal header set (D1), or does it require the wider real-client vocabulary (`X-Conversation-ID`, `X-Agent-Intent`, ...)? Live requests (non-stream + stream, `deepseek-v4.1-flash`) succeeded, so the minimal set works.
3. Does the stream ever terminate without a `[DONE]` marker? The executor appends exactly one when upstream omits it.

## Follow-up (do not start without being asked)

- Token refresh (`/v2/plugin/auth/token/refresh`, header `X-Refresh-Token`) and the background sweeper; deferred as YAGNI because the login token is valid ~1 year.
- Per-connection `base_url` honoring (D7) if a custom endpoint is ever needed.
