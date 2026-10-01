# Rust Models.dev Pricing Catalog Plan

## Goal

Implement two uses of Models.dev pricing in the Rust server: serve the catalog through `GET /v1/pricing/models`, and use matching provider/model rates to estimate each successful request's cost. Commit a reviewed snapshot under `server/src/` so both paths work offline and share the same data.

## Recommendation

Use Models.dev's combined `catalog.json` as the independent source, then normalize each provider's model offering into a compact SRouter-owned JSON snapshot at `server/src/features/catalog/data/models-dev-pricing.json`. Keep separate rows when providers have different rates for the same model. Resolve a request only through an exact provider-plus-upstream-model match, with explicit aliases where parity evidence requires them. Never select the nearest or similarly named model.

Load the snapshot once in a `features/catalog/pricing.rs` module. Give that module two narrow operations: build the public pricing list, and estimate cost from the serving provider, resolved upstream model, and normalized usage. The estimator prices non-cached input, output, cache reads, and cache writes separately, then returns their total. That estimate feeds request logs and API-key `usage_cost`, which the credit-limit middleware checks. The breakdown should also be available in request-log detail so the dashboard can show the input/output/cache amounts. These are estimates from published rates, not provider invoices or guaranteed charges.

A maintainer-run updater fetches and validates the official JSON, normalizes the required fields, and atomically writes the snapshot. Review and deploy its diff like code. Runtime requests never call Models.dev or require its availability.

Provide a read-only `check` mode to compare the current Models.dev source against the checked-in local snapshot. Store a manifest beside the snapshot with the source URL, fetch time, source SHA-256, normalized-data SHA-256, schema version, and record count. Hash the exact downloaded bytes for source drift, then normalize and serialize relevant records deterministically before hashing for meaningful catalog drift. Verify the local snapshot against its recorded normalized hash too. Report separately: source bytes changed but normalized pricing data did not; normalized pricing data changed; local snapshot does not match its manifest; or fetch/validation failed. Source-only changes produce a notice, not a failing exit status; semantic drift, local integrity failure, and fetch/validation errors return distinct nonzero statuses. The check mode never writes files. A separate explicit update mode regenerates snapshot and manifest after validation.

Run the read-only check once daily at 06:00 UTC in a scheduled GitHub Actions workflow so semantic drift is visible without silently changing the repo or deploying new rates. The workflow only reports status and summary; it must not write files, commit, create PRs, or deploy. Keep this independent from normal server requests. `refresh=true`, `force=true`, and `Cache-Control: no-cache|no-store` still operate on the deployed snapshot; updating prices requires reviewing the snapshot change and deploying a new binary.

## Source and provenance

- Models.dev official README documents `api.json`, `models.json`, and `catalog.json`; it describes `catalog.json` as the combined provider and model metadata endpoint: <https://github.com/anomalyco/models.dev/blob/dev/README.md>.
- Models.dev's schema documents provider-side pricing fields in USD per million tokens, including input, output, reasoning, cache, and audio costs. Provider pricing may differ for the same underlying model.
- The official repository has a `LICENSE` file, but the code license should not be treated as conclusive licensing for all catalog data. Before committing a full snapshot, verify data reuse/redistribution terms and record the attribution requirement. If unclear, ask the project owner before shipping the dataset.
- The Rust implementation and updater must use the official Models.dev endpoint only. `packages/*` remains prohibited as a data or code input.

## Data contract

Keep the current route response envelope: `{object: "list", total, updated_at, data}`. Preserve the existing model metadata fields: `id`, `name`, `description`, `family`, `provider`, model capability flags, `knowledge`, release dates, `cost`, `limit`, and `modalities`. The pricing page reads `cost.input`, `cost.output`, `cost.cache_read`, and `cost.reasoning`; retain `cache_write` for cost estimation even though the current table does not display it.

For flattened rows:

- `provider` identifies the serving provider from Models.dev, not the model's lab/author.
- `id` is provider-qualified so two providers' offers cannot collide. Confirm exact encoding against the pricing-page consumer.
- Preserve unknown pricing as unknown, never convert it to zero. Explicit zero is a known free rate, distinct from missing data.
- Costs are USD per million tokens and belong to a specific provider/model offer. They estimate spend; they are not provider invoices or SRouter's own resale prices.
- Inspect source tiers during schema discovery. Do not flatten context-dependent tiers into one misleading rate; represent them only if the existing consumer contract supports them.
- Keep output ordering deterministic by provider, display name, then id.
- Set `updated_at` to the snapshot source/generation time unless black-box parity establishes another meaning. A request-time refresh must not imply fresh Models.dev data.

For request-cost estimation:

- Select rates by exact SRouter serving provider plus resolved upstream model id. Keep explicit mapping data for confirmed upstream aliases; on ambiguity or no match, return "unknown price" rather than borrowing another provider's rate.
- Calculate on mutually exclusive token categories, not raw field names alone. Confirm whether each provider's prompt total includes cache-read and cache-write tokens; clamp overlapping cached counts to the applicable input total so a token is not billed twice.
- Apply each applicable rate per 1M tokens: non-cached input at `cost.input`, cache reads at `cost.cache_read`, cache creation at `cost.cache_write`, and output at `cost.output`.
- If a nonzero token category lacks a rate, mark the estimate unknown instead of presenting a partial total as the full price. Explicit zero is a known free rate. Reasoning is usually included in completion output; add `cost.reasoning` only when independent billing semantics prove it is separate.
- `UsageBreakdown` tracks prompt, completion, cached, cache-creation, and reasoning tokens, but not audio-token counts. Keep audio prices in the catalog; do not estimate audio charges until usage extraction supplies the corresponding counts.
- Calculate category subtotals and total once per completed request from accumulated usage across tool-interception turns.
- Use the calculated total for `request_logs.estimated_cost` and API-key `usage_cost`, which drives the existing credit-limit guard. Token quotas remain based on token counts, not estimated dollars.
- Missing or ambiguous rates must not become a known `$0.00` price or increase API-key spend. Preserve token accounting. The existing database column is `NOT NULL`; use zero only as its storage sentinel, derive known-vs-unknown from exact rate lookup for response enrichment, and verify this does not confuse unknown pricing with a confirmed free model. Any schema change requires an explicit decision.
- Derive log-detail input/output/cache read/cache write breakdown from stored token usage and the same snapshot, matching Node's read-time calculation if the API contract permits it. The current Rust log response omits `costBreakdown` by design in `docs/superpowers/specs/2026-09-29-rust-request-logs-mvp.md`; adding it needs that contract decision recorded before implementation. Persisting historical per-category amounts would require a separate schema decision.

## Proposed files

| File                                                                | Purpose                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/features/catalog/mod.rs`                                | Catalog feature module exports.                                                                                                                     |
| `server/src/features/catalog/pricing.rs`                            | Parse the snapshot, serve the list, select exact provider/model rates, calculate request-cost breakdowns.                                           |
| `server/src/features/catalog/data/models-dev-pricing.json`          | Compact generated, versioned data snapshot embedded in the Rust binary.                                                                             |
| `server/src/features/catalog/data/models-dev-pricing.manifest.json` | Source and normalized SHA-256 hashes, source URL, fetch time, schema version, and record count.                                                     |
| `server/scripts/update_models_dev_pricing.py`                       | Read-only `check` plus explicit update mode; validate and atomically replace snapshot and manifest. Prefer the standard library.                    |
| `.github/workflows/models-dev-pricing-drift.yml`                    | Scheduled read-only check that reports upstream/local drift without committing or deploying changes.                                                |
| `server/src/features/gateway/chat.rs`                               | Estimate cost for successful OpenAI chat completions, including streaming and tool-interception turns.                                              |
| `server/src/features/gateway/messages.rs`                           | Apply the same estimate to successful Anthropic Messages requests.                                                                                  |
| `server/src/infrastructure/database/request_logs.rs`                | Persist known estimated spend to request logs and API-key usage, preserve token accounting when price is unknown.                                   |
| `server/src/features/logs.rs`                                       | Expose known estimate and input/output/cache breakdown in log list/detail and live events, matching the Node contract.                              |
| `server/src/app.rs`                                                 | Mount `/v1/pricing/models` under `/v1` with API-key auth. Do not add `/v1/v1/pricing/models` unless the frozen contract or oracle proves it exists. |
| `server/tests/pricing.rs`                                           | Pricing route, calculator, logs/credit integration, and static-snapshot tests using local fixtures.                                                 |
| `server/TODO.md`                                                    | Close the pricing provenance blocker and track endpoint, cost calculation, and updater.                                                             |

No database schema or migration is needed.

## Implementation sequence

### 1. Lock source shape and pricing semantics

- Fetch the current official `catalog.json` in a controlled research/updater step, not from Rust runtime code.
- Record its top-level shape, provider/model counts, required and optional pricing fields, cost units, tiers, and behavior for models with no price.
- Compare the Node pricing route, the `apps/api` call sites that consume estimated prices, existing Node tests, and black-box API responses. Establish public fields, ID conventions, cache-token arithmetic, reasoning accounting, `updated_at`, and refresh behavior. Treat imported pricing helpers as opaque; do not inspect or copy `packages/*` implementation or data into Rust.
- For each SRouter adapter, identify whether the actual upstream billable provider and model map to a Models.dev provider/model offer. Do not assume SRouter's adapter id (for example an aggregator or subscription provider) equals the Models.dev provider id. Subscription-backed models without a comparable per-token rate remain unpriced.
- Resolve catalog-data reuse terms and attribution before adding the snapshot.

Completion: source schema, per-route response mapping, rate-selection rules, token arithmetic, licensing status, and compatibility deviations are documented. Unmapped adapters/models are explicitly marked as unknown-price cases.

### 2. Define and generate the normalized snapshot

- Add a small updater that reads the official combined catalog, rejects invalid/empty/unexpected payloads, and emits both the public-list fields and the provider/model rate lookup data.
- Preserve unknown/missing optional values and explicit zero prices. Keep duplicate underlying models when their serving provider or price differs.
- Include source URL, source/generated timestamp, schema version, and record count in the generated artifact or adjacent manifest.
- Write to a temporary file and replace atomically only after validation; never replace the checked-in snapshot with an empty or malformed result.
- Keep the generated JSON minimal: omit logos and unrelated provider metadata, but retain all prices needed by list display and usage estimation, including input, output, cache-read, cache-write, reasoning, audio rates, and tiers where the contract supports them.

Completion: updater fixture tests prove deterministic output, preserve zero versus missing cost, and leave the existing snapshot unchanged for invalid or empty payloads.

### 3. Add the Rust pricing module and public route

- Parse the embedded artifact once and expose narrow operations for list response construction and exact rate lookup/calculation.
- Return the existing envelope and pricing item fields, stable ordering, and `total == data.len()`.
- Apply `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
- Preserve `refresh`/`force` and no-cache/no-store behavior without runtime fetching. The deployed snapshot only changes after updater execution and a new server deployment.
- Mount only `/v1/pricing/models` and require API-key authentication, matching the frozen route contract.

Completion: the list serves the embedded snapshot offline; it exposes provider rates without claiming those rates apply to every SRouter route.

### 4. Integrate request cost estimation

- Calculate per-request breakdowns for successful non-streaming and streaming `/v1/chat/completions` and `/v1/messages` calls. Use exact provider/model mappings for billable upstreams only; Qoder/Cline subscription offerings and any unmatched model are unknown unless an authoritative comparable rate is found.
- Build mutually exclusive billable usage categories from each provider's reported usage semantics, then apply input/output/cache-read/cache-write rates. Do not assume every provider's `prompt_tokens` includes the same cache categories; avoid double counting.
- Accumulate usage and estimated cost across tool-interception turns, but do not calculate from count_tokens or failed requests as if they were billable completions.
- Store known totals in `request_logs.estimated_cost` and API-key `usage_cost`, so usage stats and credit-limit checks use the estimate. Keep token quota accounting independent.
- Define the unknown-price persistence behavior before implementation: persisted `estimated_cost` is non-nullable. Do not present its zero sentinel as a confirmed free cost, and do not increase credit spend when no valid rate exists. Do not add a schema migration without explicit approval.
- Ensure stream completion records final usage and estimated cost exactly once, including disconnect/error handling consistent with existing logging semantics.

Completion: fixture-driven calculator tests cover regular input/output, cache read/write, free rates, unknown prices, provider/model non-matches, multi-turn tool usage, and no double-counted reasoning. Gateway tests prove logs and API-key spend receive the same total.

### 5. Surface estimate and breakdown in logs

- Match Node's detail enrichment: total estimated cost plus input, output, cache-read, cache-write, and reasoning amounts when the exact rate and token usage are known.
- The current Rust log-response spec explicitly omits `costBreakdown`, while the web log detail component consumes it. Resolve this API-contract discrepancy and record approval before adding response fields. Do not silently diverge from the Rust log spec or leave the dashboard without the feature if pricing integration is intended to expose it.
- Decide whether to enrich from the deployed snapshot on log reads, as Node does, or to persist historical per-category amounts. Read-time calculation can reprice old requests after snapshot updates; durable historical amounts require a schema change.
- Cover list/detail/live-event consumers and usage stats only after deciding which response shapes should carry the breakdown.

Completion: log tests distinguish confirmed free prices from unknown rates, cover cache fields and stable totals, and pin the approved response contract with a black-box comparison.

### 6. Add hash drift detection and maintenance

- Implement updater subcommands for read-only `check` and explicit snapshot update. Check mode recomputes local normalized data hash, fetches source bytes, computes the raw source hash, normalizes using the same parser, and computes the canonical normalized hash.
- Define deterministic normalization and hash inputs: stable provider/model ordering, stable JSON key ordering, UTF-8 encoding, compact JSON serialization, and exclusion of volatile fields such as fetch time from the normalized-data hash.
- Report source-only byte changes as notice; return distinct nonzero exit statuses for semantic drift, local integrity failure, and fetch/validation failure.
- Tests cover identical source, harmless raw-byte change with same normalized data, meaningful normalized-data drift, tampered local snapshot, malformed/empty source, and check mode leaving snapshot and manifest unchanged.
- Add a daily 06:00 UTC GitHub Actions schedule to run check mode. It reports status and a summary only, and never updates files, commits, opens a PR, or deploys. Document how to inspect drift, run explicit update, review the generated diff, and deploy.
- Record source URL, retrieval timestamp, attribution, and updater command. Update the §7 backlog only after source/license and test gates pass.

Completion: the scheduled check flags source or semantic drift without writing repo files; the explicit update command produces a deterministic reviewed snapshot and matching manifest.

## Verification

Run the fixture-driven pricing tests plus the existing focused tests whose paths are affected:

```bash
cargo test --manifest-path server/Cargo.toml --test pricing
cargo test --manifest-path server/Cargo.toml --test chat_completions
cargo test --manifest-path server/Cargo.toml --test messages
cargo test --manifest-path server/Cargo.toml --test logs
cargo test --manifest-path server/Cargo.toml --test api_key_auth
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

The updater's standard-library tests use captured fixtures. Cargo tests must not call Models.dev or read a real user database. Do not run forbidden pnpm builds or dev servers.

## Open decisions before implementation

1. Confirm the pricing page's model ID format and whether it can display every provider-specific offer; provider-qualified IDs avoid collisions and preserve provider-specific rates.
2. Which live SRouter adapters have an exact Models.dev billable provider/model match? In particular, do not treat Qoder/Cline subscription credits as per-token costs without evidence.
3. Should Rust logs add `costBreakdown` to match the current web log detail consumer, despite the Rust log MVP spec explicitly omitting it? If approved, should the breakdown be recomputed from the current snapshot or persisted historically?
4. How should a known free rate be distinguished in log responses from the existing `estimated_cost = 0` storage sentinel for unknown pricing, without changing the database contract?
5. Are Models.dev catalog data and pricing fields explicitly reusable under the published terms, and what attribution is required?
6. Which owner or channel will monitor failed scheduled drift runs and act on semantic changes? The proposed initial schedule is daily at 06:00 UTC; workflow must stay read-only.

## Out of scope

- Live Models.dev requests during normal API requests.
- Changing token quota arithmetic or claiming that estimated Models.dev costs are the provider's actual bill.
- Migrating the broader `/v1/models` catalog behavior.
- Reading `packages/*` for source data or building the Rust snapshot from package contents.
