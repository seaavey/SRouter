# Providers & Executors

## Provider Constants

Provider metadata belongs in:

```text
packages/constants/src/providers/
```

Rules:

- one file per provider
- catalog composition only in `catalog.ts`
- avoid inline hardcoded provider metadata

Helpers:

```ts
isKnownProvider()
```

## Executors

Executors are upstream drivers.

Patterns:

- one executor per provider
- provider-specific retry logic stays local
- registration happens centrally
- isolate upstream protocol quirks

Adding a provider:

1. add constants (`packages/constants/src/providers/<provider>.ts`)
2. add executor (`packages/executors/src/drivers/<provider>.executor.ts`)
3. register catalog entry (`packages/constants/src/providers/catalog.ts`)
4. add schemas/types (`packages/types/src/schemas/providers.ts`)
5. add translation support if needed (`packages/translator`)

## Connection Verification

When implementing or modifying provider verification in `apps/api/src/logic/providers.logic.ts`:
- Always use the user-supplied `base_url` (or provider standard default if omitted) to resolve the verification URL.
- Never fallback to standard `https://api.openai.com/v1/models` for custom / 3rd-party OpenAI-compatible providers, as their API keys will be rejected with HTTP 401.
- Provide descriptive verification errors indicating whether failure was due to invalid credentials, incorrect `base_url`, or upstream rejection.

## Translation Layer

`packages/translator` must stay pure.

Forbidden:

- fs
- fetch
- timers
- env access

Responsibilities:

- OpenAI ↔ Anthropic conversion
- stream translation
- tool translation
- schema normalization

Antigravity schema normalization:

```ts
cleanJSONSchemaForAntigravity()
```

Avoid mutating original payload references.
