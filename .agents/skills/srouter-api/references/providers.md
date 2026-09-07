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

1. add constants
2. add executor
3. register catalog entry
4. add schemas/types
5. add translation support if needed

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
