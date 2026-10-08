# `@srouter/pricing` (retired)

The pricing catalog and its matcher: `pricing.jsonc` (192 KB of model prices) plus the parser and
the lookup that matched an upstream model id to a catalog row. Version 0.1.8, dependency
`@srouter/types`, 7 files and 861 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`index.ts`, `pricing.ts`, `parser.ts`, `matcher.ts`, `types.ts`, the `pricing.jsonc` data file, and
`scripts/` for maintaining it. The public surface was `getModelMetadata` and the pricing list the
API served.

## Who imported it

`apps/cli/src/adapters/opencode.ts` (`getModelMetadata`), `packages/translator/src/usage.ts`, and
through the translator the `executors` package. The Node API served the catalog to the dashboard.

## Why it is gone

Pricing became a Rust feature: `server/src/features/catalog/pricing.rs` serves the catalog, and
`GET /v1/models/pricing` returns it to clients. Keeping the TypeScript side meant the same prices
existed twice, with a JSONC file that only one of the two implementations watched.

## Replacement

| Used to get | Now |
| --- | --- |
| Model pricing | `server/src/features/catalog/pricing.rs` |
| The served list | `GET /v1/models/pricing` |
| Cost estimation in log records | The gateway's usage accounting in `server/src/features/gateway/` |
| CLI model metadata | `apps/cli/src/lib/pricing.ts` (local lookup) |

## Recovery

```bash
git show backup/pre-packages-removal:packages/pricing/pricing.jsonc | head -40
```
