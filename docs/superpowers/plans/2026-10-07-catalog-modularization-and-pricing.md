# Catalog Modularization and Pricing (Section 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the model catalog from `gateway` into `features/catalog/`, implement the `GET /v1/pricing/models` endpoint backed by an independent Models.dev snapshot with caching headers, and link token cost estimation to `request_logs`.

**Architecture:** Consolidates all catalog domains (`models.rs`, `quota.rs`, `pricing.rs`) under `server/src/features/catalog/`. Serves model pricing through an in-memory cache over a compile-time embedded dataset, while keeping gateway request execution clean and calculating `estimated_cost` for completed requests based on token breakdowns and model rates.

**Tech Stack:** Rust 2024 edition, Axum 0.8, Serde / Serde JSON, Tokio, SQLx (SQLite WAL).

**Spec:**

- Backlog: `TODO.md` §7 ("Catalog: models, pricing, quota")
- Contract: `docs/api-v1-contract.md`
- Design draft: `docs/superpowers/plans/2026-10-01-server-models-dev-pricing.md`
- Oracle reference: `apps/api/tests/pricing-route.test.ts` and `apps/api/src/routes/v1/pricing.ts`

## Global Constraints

- Never import, copy, or read code or data from `packages/*` (`AGENTS.md`). All pricing data and schemas are sourced independently from official Models.dev data.
- The Rust server does not make external network requests at runtime to fetch pricing data. The catalog is embedded at compile-time and parsed in memory.
- `GET /v1/pricing/models` must be mounted strictly under `/v1` and carries `api_key_auth`. It is NEVER mounted on `/v1/v1/pricing/models` (which must return `404`).
- `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` must be present on `/v1/pricing/models` responses.
- Explicit zero costs (`cost.input == 0.0 && cost.output == 0.0`) denote free models and must be preserved as `0.0`. Missing or unpriced models must preserve `None` / `null`, never coerced to zero.
- Run tests strictly via `cargo test --manifest-path server/Cargo.toml --test <file>`. Never run root `pnpm test` or dev servers.
- `cargo clippy --all-targets --all-features --locked -- -D warnings` and `cargo fmt --check` must remain 100% clean.

## Review Focus

1. **Unpriced or unknown model requests**: Returning `None` from `estimate_cost` must record `0.0` as the database storage sentinel in `request_logs.estimated_cost`, without marking the model as explicitly free.
2. **Cache tokens overlap in prompt tokens**: In OpenAI formats, `prompt_tokens` includes `cached_tokens`. Input cost calculation must subtract cached tokens (`(prompt - cached).max(0)`) to avoid double-charging.
3. **Cache-Control revalidation**: `Cache-Control: no-cache` or `no-store` in the request header, or query parameters `refresh=true` / `force=1`, must trigger catalog cache revalidation.
4. **Compat route isolation**: `GET /v1/v1/pricing/models` must return `404 Not Found`, while `GET /v1/v1/models` continues to succeed.
5. **Deterministic list ordering**: The `/v1/pricing/models` list output must sort deterministically (by provider ascending, then model name ascending).

---

### Task 1: Relocate Model Catalog to `features/catalog/models.rs`

Move `server/src/features/gateway/models.rs` to `server/src/features/catalog/models.rs` and update exports in `features/catalog/mod.rs` and `features/gateway/`.

**Files:**

- Create: `server/src/features/catalog/models.rs` (relocated from `server/src/features/gateway/models.rs`)
- Remove: `server/src/features/gateway/models.rs`
- Modify: `server/src/features/catalog/mod.rs`
- Modify: `server/src/features/gateway/mod.rs`
- Modify: `server/src/features/gateway/routes.rs`
- Modify: `server/src/app.rs`
- Test: `server/tests/models.rs`

**Interfaces:**

- Consumes: `AppState`, `AppDatabase`, `APIPrincipal`, `catalog_flags`, `providers` DB repos
- Produces: `create_models_read_router() -> Router<AppState>`, `create_models_write_router() -> Router<AppState>` exported from `crate::features::catalog`

- [ ] **Step 1: Relocate `models.rs` to `features/catalog/models.rs` and update module declarations**
      Move `server/src/features/gateway/models.rs` to `server/src/features/catalog/models.rs`.
      In `server/src/features/catalog/mod.rs`:

```rust
pub mod models;
pub mod quota;

pub use models::{create_models_read_router, create_models_write_router};
pub use quota::{QuotaCache, create_quota_router};
```

In `server/src/features/gateway/mod.rs`:
Remove `pub mod models;` and router re-exports.
In `server/src/features/gateway/routes.rs`:
Remove models router builder functions and models handler references.
In `server/src/app.rs`:
Update imports to use `crate::features::catalog::{create_models_read_router, create_models_write_router}`.

- [ ] **Step 2: Run existing model tests to verify parity and non-breakage**
      Run: `cargo test --manifest-path server/Cargo.toml --test models`
      Expected: PASS (all 18 integration tests pass).

- [ ] **Step 3: Run existing csrf, providers, and http_runtime tests to verify routing unchanged**
      Run: `cargo test --manifest-path server/Cargo.toml --test csrf --test providers --test http_runtime`
      Expected: PASS.

- [ ] **Step 4: Check formatting and clippy**
      Run: `cargo fmt --manifest-path server/Cargo.toml -- --check && cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/features/catalog/ server/src/features/gateway/ server/src/app.rs
git commit -m "refactor(server): relocate model catalog into features/catalog"
```

---

### Task 2: Pricing Dataset Snapshot and Provenance Manifest

Create the independent models.dev pricing data snapshot, provenance manifest, and offline update/check script.

**Files:**

- Create: `server/src/features/catalog/data/models-dev-pricing.json`
- Create: `server/src/features/catalog/data/models-dev-pricing.manifest.json`
- Create: `server/scripts/update_models_dev_pricing.py`
- Test: `server/tests/pricing.rs` (snapshot validity test)

**Interfaces:**

- Consumes: Independent data from `https://models.dev/catalog.json` (offline generation)
- Produces: Embedded static JSON snapshot in `features/catalog/pricing.rs`

- [ ] **Step 1: Write `server/scripts/update_models_dev_pricing.py`**
      Implement the offline maintenance script supporting `--check` (validate file existence, json parse, record count > 2000, and sha256 checksum against manifest) and `--update` (fetch official `catalog.json`, normalize models, write snapshot and manifest atomically).

- [ ] **Step 2: Generate `models-dev-pricing.json` and `models-dev-pricing.manifest.json`**
      Run script to create the initial clean, normalized snapshot containing models with `{ id, name, description, family, provider, cost: { input, output, cache_read, cache_write, reasoning }, limit, modalities }`.
      Verify record count > 2000 and manifest has valid SHA-256.

- [ ] **Step 3: Run `--check` to verify snapshot integrity**
      Run: `python3 server/scripts/update_models_dev_pricing.py --check`
      Expected: PASS with 0 exit code and "Manifest and snapshot verified".

- [ ] **Step 4: Commit**

```bash
git add server/src/features/catalog/data/ server/scripts/update_models_dev_pricing.py
git commit -m "feat(server): add independent models.dev pricing dataset snapshot and manifest"
```

---

### Task 3: Pricing Catalog Endpoint `GET /v1/pricing/models`

Implement `server/src/features/catalog/pricing.rs` with models pricing list serialization, in-memory caching, Cache-Control header constants, and route mounting.

**Files:**

- Create: `server/src/features/catalog/pricing.rs`
- Modify: `server/src/features/catalog/mod.rs`
- Modify: `server/src/constants.rs`
- Modify: `server/src/app.rs`
- Test: `server/tests/pricing.rs`

**Interfaces:**

- Consumes: `AppState`, `APIPrincipal`, `models-dev-pricing.json`
- Produces: `create_pricing_router() -> Router<AppState>` mounted at `/v1`

- [ ] **Step 1: Write integration tests in `server/tests/pricing.rs`**
      Write tests:

1. `pricing_endpoint_returns_catalog_with_caching_headers`: asserts 200, `Cache-Control` contains `max-age=3600` and `stale-while-revalidate=86400`, `object: "list"`, `total > 0`, `data.len() == total`.
2. `pricing_endpoint_requires_api_key_auth`: non-loopback request without API key returns 401.
3. `pricing_endpoint_honors_refresh_and_no_cache`: `?refresh=true`, `?force=1`, or `Cache-Control: no-cache` revalidates without error.
4. `pricing_preserves_explicit_free_and_unknown_prices`: verify models with 0 rates keep `cost.input == 0.0`, while unpriced models omit cost fields.
5. `pricing_endpoint_not_mounted_on_compat_v1_v1`: `GET /v1/v1/pricing/models` returns 404.

- [ ] **Step 2: Run test to verify it fails**
      Run: `cargo test --manifest-path server/Cargo.toml --test pricing`
      Expected: FAIL (route / module not implemented).

- [ ] **Step 3: Implement `server/src/features/catalog/pricing.rs`**

1. Add constant `constants::headers::value::PRICING_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"`.
2. Define models: `PricingListResponse`, `ModelPricingItem`, `ModelCost`, `ModelLimit`, `ModelModalities`.
3. Implement `PricingCache` holding parsed `PricingListResponse` wrapped in `Arc<RwLock<...>>` with generation timestamp.
4. Implement handler `get_pricing_models(Query(params), headers)` returning `Response` with `PRICING_CACHE_CONTROL` and JSON body.
5. Define `create_pricing_router() -> Router<AppState>`.
6. Export from `features/catalog/mod.rs` and mount in `server/src/app.rs` under `/v1` with `api_key_auth`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `cargo test --manifest-path server/Cargo.toml --test pricing`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/features/catalog/pricing.rs server/src/features/catalog/mod.rs server/src/constants.rs server/src/app.rs server/tests/pricing.rs
git commit -m "feat(server): implement GET /v1/pricing/models with caching headers"
```

---

### Task 4: Token Cost Estimator and Request Logs Linkage

Implement request cost estimation in `pricing.rs` and link it to gateway logging in `logging.rs`.

**Files:**

- Modify: `server/src/features/catalog/pricing.rs`
- Modify: `server/src/features/gateway/interception/logging.rs`
- Modify: `server/tests/pricing.rs`
- Test: `server/tests/chat_completions.rs`
- Test: `server/tests/logs.rs`

**Interfaces:**

- Consumes: `provider_id: &str`, `model: &str`, `resolved_model: Option<&str>`, `usage: &UsageBreakdown`
- Produces: `pub fn estimate_cost(...) -> Option<f64>` in `crate::features::catalog`

- [ ] **Step 1: Write unit tests for `estimate_cost` in `server/tests/pricing.rs`**

1. Test standard model cost: given input tokens and output tokens, calculates exact USD cost.
2. Test cached token discount: non-cached input = `(prompt - cached).max(0)`.
3. Test free model returns `Some(0.0)`.
4. Test unknown / unpriced model returns `None`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `cargo test --manifest-path server/Cargo.toml --test pricing estimate_cost`
      Expected: FAIL (`estimate_cost` function not found).

- [ ] **Step 3: Implement `estimate_cost` in `features/catalog/pricing.rs`**

```rust
pub fn estimate_cost(
    provider_id: &str,
    model: &str,
    resolved_model: Option<&str>,
    usage: &UsageBreakdown,
) -> Option<f64>
```

1. Resolve rate from embedded pricing lookup (match by `resolved_model` then `model`, stripping provider prefixes `zen/`, `opencode/`, etc.).
2. If unpriced or model unknown, return `None`.
3. Calculate:
    - `non_cached_prompt = (usage.prompt_tokens - usage.cached_tokens - usage.cache_creation_tokens).max(0)`
    - `prompt_cost = non_cached_prompt as f64 * cost.input / 1_000_000.0`
    - `cache_read_cost = usage.cached_tokens as f64 * cost.cache_read.unwrap_or(cost.input) / 1_000_000.0`
    - `cache_write_cost = usage.cache_creation_tokens as f64 * cost.cache_write.unwrap_or(cost.input) / 1_000_000.0`
    - `output_cost = usage.completion_tokens as f64 * cost.output / 1_000_000.0`
    - Sum total.
4. In `server/src/features/gateway/interception/logging.rs`:
   Inside `log_request`:
    ```rust
    let estimated_cost = if status_code == 200 {
        crate::features::catalog::estimate_cost(provider_id, model, resolved_model, usage).unwrap_or(0.0)
    } else {
        0.0
    };
    ```
    Pass `estimated_cost` to `apply_usage_accounting` and `repository.increment_usage`.

- [ ] **Step 4: Run pricing, chat_completions, and logs tests**
      Run: `cargo test --manifest-path server/Cargo.toml --test pricing --test chat_completions --test logs`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/features/catalog/pricing.rs server/src/features/gateway/interception/logging.rs server/tests/pricing.rs
git commit -m "feat(server): link token cost estimation to request logs and usage accounting"
```

---

### Task 5: Documentation and TODO Backlog Update

Update `TODO.md` to check off Section 7 items and document the resolved pricing provenance and layout.

**Files:**

- Modify: `TODO.md`
- Modify: `.local/TASK.md`
- Modify: `.local/CONTEXT.md`

- [ ] **Step 1: Update `TODO.md` Section 7**
      Mark `[x]` on:
- `GET /v1/pricing/models` with caching headers and provenance documentation.
- `Create features/catalog/ per the plan layout and move the model/pricing/quota routes there`.
  Update notes explaining the independent models.dev offline snapshot and cost estimation linkage.

- [ ] **Step 2: Run full clippy and test check on `server/`**
      Run:
      `cargo fmt --manifest-path server/Cargo.toml -- --check`
      `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings`
      `cargo test --manifest-path server/Cargo.toml --locked`
      Expected: ALL PASS with 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs(server): record section 7 catalog and pricing completion in TODO"
```
