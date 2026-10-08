# `@srouter/constants` (retired)

Provider catalog metadata, built-in provider seeds, and the version strings the clients reported.
Version 0.1.8, dependency `@srouter/types`, 23 files and 683 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`providers.ts` plus the `providers/` subtree (`catalog.ts`, `categories.ts`, `types.ts`,
`openai.ts`, `opencode.ts`, `minimax.ts`, `neosantara.ts`, `index.ts`), `seed.ts`, `version.ts`.

The exported surface was small and mostly static data: `CATEGORY_LABELS`, `CATEGORY_DESCRIPTIONS`,
`CATEGORY_ORDER`, `getProviderWebsiteUrl`, `KNOWN_PROVIDERS`, `KNOWN_PROVIDER_MAP`, `providerBaseId`,
the per-provider model lists such as `ANTIGRAVITY_MODELS`, the built-in seeds, and
`APP_VERSION`/`CLI_VERSION`.

## Who imported it

`apps/web` (`CATEGORY_LABELS`, `CATEGORY_DESCRIPTIONS`, `CATEGORY_ORDER`, `getProviderWebsiteUrl`,
`KNOWN_PROVIDERS`, `KNOWN_PROVIDER_MAP`, `providerBaseId`, `ANTIGRAVITY_MODELS`, `APP_VERSION`),
`apps/cli` (`CLI_VERSION`), and every other package except `pricing`. `apps/cli/tests/cli.test.ts`
asserted the CLI's reported version against `CLI_VERSION`, which is why the version string had two
homes.

## Why it is gone

Two different kinds of data shared one package:

- **Provider facts** (ids, aliases, categories, endpoints, seeded models). These now live beside the
  Rust drivers in `server/src/features/providers/**` and reach clients through the API
  (`GET /v1/providers/catalog` and the provider detail entries).
- **Presentational labels** (display names, descriptions, websites, category ordering). These were
  never authoritative anywhere except the dashboard that renders them.

Keeping the Node copy meant a third copy of the provider list, next to the Rust registry and the
deleted Node API.

## Replacement

| Used to get | Now |
| --- | --- |
| Provider facts | `server/src/features/providers/` and the served catalog |
| Dashboard labels and ordering | Local to `apps/web` |
| `APP_VERSION` | `apps/web/package.json` |
| `CLI_VERSION` | `apps/cli/package.json` |

## Recovery

```bash
git show backup/pre-packages-removal:packages/constants/src/providers/catalog.ts
```
