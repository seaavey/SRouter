# Rust Models.dev Pricing Catalog Plan

## Goal

Implement `GET /v1/pricing/models` in the Rust server using a reviewed, generated snapshot of the Models.dev catalog committed under `server/src/`. Keep the API useful without network access at runtime, preserve existing pricing response behavior where it is part of the API contract, and make catalog updates explicit and reviewable.

## Recommendation

Use Models.dev's combined `catalog.json` as the independent source, then flatten each provider's model entries into a compact SRouter-owned JSON snapshot at `server/src/features/catalog/data/models-dev-pricing.json`. A provider's price belongs to that provider's offering, so retain separate rows when the same underlying model is sold by multiple providers. Use a stable composite identity (`provider_id/model_id`) unless black-box parity shows the existing consumer depends on another exact ID convention.

Load the committed file with `include_str!` and parse it once in the pricing module. Runtime requests must not call Models.dev, require credentials, or use the database. A maintainer-run updater fetches and validates the official JSON, normalizes only fields the endpoint needs, and atomically writes the snapshot. The updater's diff is reviewed and deployed like code.

`refresh=true`, `force=true`, and `Cache-Control: no-cache|no-store` operate on the snapshot included in the running binary; they do not fetch a new catalog. Getting newer source data requires running the updater and deploying a new binary. This matches a bundled-catalog model and avoids making a public pricing read dependent on Models.dev availability.

## Source and provenance

- Models.dev official README documents `api.json`, `models.json`, and `catalog.json`; it describes `catalog.json` as the combined provider and model metadata endpoint: <https://github.com/anomalyco/models.dev/blob/dev/README.md>.
- Models.dev's schema documents provider-side pricing fields in USD per million tokens, including input, output, reasoning, cache, and audio costs. Provider pricing may differ for the same underlying model.
- The official repository has a `LICENSE` file, but the code license should not be treated as conclusive licensing for all catalog data. Before committing a full snapshot, verify data reuse/redistribution terms and record the attribution requirement. If unclear, ask the project owner before shipping the dataset.
- The Rust implementation and updater must use the official Models.dev endpoint only. `packages/*` remains prohibited as a data or code input.

## Data contract

Keep the current route response envelope: `{object: "list", total, updated_at, data}`. Preserve the existing model metadata fields: `id`, `name`, `description`, `family`, `provider`, model capability flags, `knowledge`, release dates, `cost`, `limit`, and `modalities`.

For flattened rows:

- `provider` identifies the serving provider from Models.dev, not the model's lab/author.
- `id` is provider-qualified so two providers' offers cannot collide. Confirm the exact encoding against the current API consumer before implementation.
- Preserve models with unknown pricing. Missing cost is `null`/omitted, never silently converted to zero; an explicit zero remains a real free price.
- Preserve provider-specific prices as reported. Costs are USD per million tokens; do not treat them as SRouter's actual upstream billing rate or use them for quota deductions without a separate policy decision.
- Inspect current Models.dev cost tiers and any new fields during schema discovery. If tiered pricing exists, do not flatten it into a misleading single rate; add an optional tier representation only after checking the API/web contract impact.
- Keep output ordering deterministic by provider then display name then id.
- Set `updated_at` to the snapshot generation/source timestamp, or preserve the currently observed Node meaning if black-box parity establishes it. Do not imply that a request-time cache refresh downloaded new source data.

## Proposed files

| File                                                       | Purpose                                                                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/features/catalog/mod.rs`                       | Catalog feature module exports.                                                                                                                                              |
| `server/src/features/catalog/pricing.rs`                   | Snapshot parsing, normalization, deterministic list response, and route handler.                                                                                             |
| `server/src/features/catalog/data/models-dev-pricing.json` | Compact generated, versioned data snapshot embedded in the Rust binary.                                                                                                      |
| `server/scripts/update_models_dev_pricing.py`              | Explicit updater: download, validate, normalize, and atomically replace the snapshot. Use Python standard library only unless the repo has an established script dependency. |
| `server/src/app.rs`                                        | Mount `/v1/pricing/models` under `/v1` with API-key auth. Do not add `/v1/v1/pricing/models` unless the frozen contract or oracle proves that alias exists.                  |
| `server/tests/pricing.rs`                                  | Route, response, authentication, static-snapshot, and refresh semantics tests using local fixtures only.                                                                     |
| `server/TODO.md`                                           | Close the pricing provenance blocker and track the Rust route and updater.                                                                                                   |

No database schema or migration is needed.

## Implementation sequence

### 1. Lock source shape and compatibility

- Fetch the current official `catalog.json` in a controlled research/updater step, not from Rust runtime code.
- Record its top-level shape, provider/model counts, required and optional pricing fields, cost units, tiers, and behavior for models with no price.
- Compare the existing Node route's response shape and a black-box response to establish which fields, ID conventions, `updated_at` semantics, and refresh behavior consumers rely on. Do not read or copy data from `packages/*` into Rust.
- Resolve catalog-data reuse terms and attribution before adding the snapshot.

Completion: source schema, output mapping, pricing units, licensing status, and compatibility deviations are written into this plan or implementation notes.

### 2. Define and generate the normalized snapshot

- Add a small updater that reads the official combined catalog, rejects invalid/empty/unexpected payloads, and maps provider model offerings into the SRouter response fields.
- Preserve unknown/missing optional values and explicit zero prices. Keep duplicate underlying models when their serving provider or price differs.
- Include source URL, source/generated timestamp, schema version, and record count in the generated artifact or adjacent manifest.
- Write to a temporary file and replace atomically only after validation; never replace the checked-in snapshot with an empty or malformed result.
- Keep the generated JSON minimal: do not vendor logos, unrelated provider metadata, or the complete upstream payload if the endpoint does not use it.

Completion: running the updater against a captured fixture produces deterministic normalized records, while invalid and empty fixtures leave the existing output unchanged.

### 3. Add the Rust pricing module and route

- Parse the embedded artifact once and expose a narrow list operation to the handler.
- Return the existing envelope and pricing item fields, with stable ordering and `total == data.len()`.
- Apply `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
- Preserve `refresh`/`force` and no-cache/no-store request handling without adding a runtime fetch; document that these only bypass/rebuild any derived response cache for the deployed snapshot.
- Mount only `/v1/pricing/models` and require API-key authentication, matching the frozen route contract.

Completion: the route serves the embedded snapshot offline, with no database or upstream dependency.

### 4. Add regression and data-quality tests

- Verify success envelope, cache header, total, deterministic ordering, and representative metadata.
- Verify duplicate model ids across providers remain distinguishable.
- Verify explicit zero prices survive and unknown prices remain unknown.
- Verify API-key auth behavior and the route's refresh/no-cache semantics.
- Test parsing against small committed fixtures, not the live network; test malformed, empty, and schema-drift payloads in the updater.
- Add a snapshot integrity test that checks schema version, nonzero record count, and equality between manifest count and parsed record count. Avoid pinning a brittle upstream total.
- Compare one representative response against the current Node endpoint as black-box evidence, and record intentional differences such as provider-qualified ids or added cost tiers.

Completion: focused Rust tests cover both the fixture parser and HTTP route without calling Models.dev or touching a user database.

### 5. Document refresh and maintenance

- Document the updater command and review expectations near the script or in `server/TODO.md`.
- Record the source URL, retrieval timestamp, attribution, and how to update the snapshot.
- Update the §7 pricing backlog row from blocked on provenance to implemented only after source/license and test gates pass.

Completion: a maintainer can refresh the snapshot with one documented command, inspect the diff, and deploy it through the normal Rust release process.

## Verification

Run focused checks only:

```bash
cargo test --manifest-path server/Cargo.toml --test pricing
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

Also run the updater's standard-library tests or fixture mode. Do not invoke live Models.dev from Cargo tests, and do not run forbidden pnpm builds or dev servers.

## Open decisions before implementation

1. Should the pricing endpoint list every provider-specific offering (recommended for correct provider prices), or one canonical row per underlying model? The recommendation is provider-specific rows with a composite id.
2. Does the existing web consumer accept provider-qualified IDs and optional cost tiers, or must the response stay byte-for-byte compatible with the Node output?
3. Are Models.dev catalog data and its pricing fields explicitly reusable under the repository's published terms, and what attribution is required?
4. Should a future scheduled automation propose snapshot-update PRs, or should updates remain maintainer-triggered? Runtime fetching is not recommended.

## Out of scope

- Live Models.dev requests during normal API requests.
- Using this catalog to calculate or deduct SRouter API-key credits, quotas, or actual provider charges.
- Migrating the broader model catalog route or changing `/v1/models` behavior.
- Reading `packages/*` for source data or building the Rust snapshot from package contents.
