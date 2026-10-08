# `@srouter/types` (retired)

Shared Zod schemas and the JSON wire types the Node API spoke. Version 0.1.8, dependency `zod`,
12 modules in `src/` and 1442 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`chat.ts`, `openai.ts`, `anthropic.ts`, `provider.ts`, `schemas.ts` (plus `schemas/models.ts`,
`schemas/pricing.ts`, `schemas/settings.ts`), `quota.ts`, `logs.ts`, `fallbacks.ts`,
`tokenSaver.ts`, `auth.ts`, `images.ts`, `attemptBudget.ts`.

The package carried two different things under one name:

- **Wire shapes**, which described what the API sent and received (`ModelObjectSchema`, log records,
  usage stats, quota, pricing, provider entries).
- **Client-side validation**, through Zod schemas such as `CreateProviderZod`, used by the dashboard
  forms and by the Node API's request validation.

## Who imported it

`apps/web` (type-only imports of `CreateProviderZod`, `ModelPricingItem`, `ProviderUsageMetric`,
`FallbackRule`, `CreateFallbackRuleInput`, `PricingListResponse`, `ProviderCategory`, and the
`AuthPollStatus` value), plus every other package except `constants` and `pricing` importing their
own way back to it. `apps/cli` declared the dependency and never imported it.

## Why it is gone

The wire shapes are the Rust crate's job now. `server/bindings.rs` and `server/src/bin/export_ts.rs`
render them into `server/bindings.ts` with `specta`, and CI regenerates that file and fails on drift.
The Zod half only existed to validate the Node API's own inputs, and a client-side schema that
describes a request the Rust API validates differently is a second source of truth.

## Replacement

| Used to get | Now |
| --- | --- |
| Wire response and request shapes | `server/bindings.ts` (53 exported types) |
| Client-only types (form state, view models) | Local to `apps/web/src/lib/` or the CLI module that needs it |
| Request validation | The Rust handlers' own validation, documented per route in `docs/api-v1-contract.md` |

## Recovery

```bash
git show backup/pre-packages-removal:packages/types/src/index.ts
```
