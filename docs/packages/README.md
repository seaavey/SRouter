# Workspace packages (retired)

The seven pnpm workspace packages under `packages/` were deleted on 2026-10-08 by owner instruction.
They were the runtime modules of the Node API: the API itself (`apps/api`) had already been replaced
by the Rust crate in `server/`, which left the packages without a runtime consumer except the web
dashboard and the CLI.

The whole set is preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`) and in git
history. Nothing here may be reintroduced: the Rust crate is the implementation, `server/bindings.ts`
is the wire-type source, and client-only data belongs to the client that needs it.

## What each package was, and what replaces it

| Package | Purpose | Replaced by | Page |
| --- | --- | --- | --- |
| `@srouter/types` | Shared Zod schemas and wire types | `server/bindings.ts` plus client-local types | [types.md](./types.md) |
| `@srouter/constants` | Provider catalog metadata, seeds, version strings | The Rust provider registry and each client | [constants.md](./constants.md) |
| `@srouter/db` | SQLite (`node:sqlite`) and PostgreSQL (`pg`) repositories | `server/src/infrastructure/database/` | [db.md](./db.md) |
| `@srouter/executors` | Upstream provider drivers and SSE handling | `server/src/features/providers/` | [executors.md](./executors.md) |
| `@srouter/pricing` | Pricing catalog (`pricing.jsonc`) and model matching | `server/src/features/catalog/pricing.rs` | [pricing.md](./pricing.md) |
| `@srouter/providers` | Provider registry, OAuth flows, quotas, circuit breaker | `server/src/features/providers/` and `features/provider_auth/` | [providers.md](./providers.md) |
| `@srouter/translator` | OpenAI to Anthropic translation, usage accounting | `server/src/features/gateway/translation/` | [translator.md](./translator.md) |

Size at removal: 138 TypeScript files, 20276 lines across `src/` and `tests/`.

## Who consumed them at the end

Only two workspace apps still imported a package when the set was deleted; every other edge ran
package to package.

| Consumer | Imported | Symbols |
| --- | --- | --- |
| `apps/web` | `@srouter/types` | `CreateProviderZod` (type only), `ModelPricingItem`, `ProviderUsageMetric`, `FallbackRule`, `CreateFallbackRuleInput`, `PricingListResponse`, `AuthPollStatus`, `ProviderCategory` |
| `apps/web` | `@srouter/constants` | `CATEGORY_LABELS`, `CATEGORY_DESCRIPTIONS`, `CATEGORY_ORDER`, `getProviderWebsiteUrl`, `KNOWN_PROVIDERS`, `KNOWN_PROVIDER_MAP`, `providerBaseId`, `ANTIGRAVITY_MODELS`, `APP_VERSION` |
| `apps/cli` | `@srouter/db` | `SROUTER_DIR`, `getDatabasePath`, `initDatabase`, `LEGACY_DB_LOCATIONS`, `exportDatabaseSnapshot`, `replaceDatabaseFromFile`, `validateDatabaseImport` |
| `apps/cli` | `@srouter/constants` | `CLI_VERSION` |
| `apps/cli` | `@srouter/pricing` | `getModelMetadata` |
| nothing | `@srouter/executors`, `@srouter/providers` | no consumer outside `packages/` |

`apps/cli` declared `@srouter/types` without importing it. Internal edges were
`executors -> translator -> pricing -> types`, `db -> constants -> types`,
`providers -> constants -> types`, and `pricing -> types`.

## Recovering a package

```bash
git checkout backup/pre-packages-removal -- packages/<name>
```

Read-only inspection works the same way with `git show backup/pre-packages-removal:packages/<name>/src/<file>.ts`.
