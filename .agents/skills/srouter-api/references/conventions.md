# Coding Conventions

## PascalCase Enforcement

Use PascalCase for:

- controllers
- routers
- middleware
- helpers
- logic methods
- domain variables

Examples:

```ts
ChatController.CreateCompletion
ModelsController.ListModels
RequireAdmin
AuthRouter
```

Avoid lowercase aliases.

## Response Helpers

Use helpers from:

```text
@/utils/response.js
```

Helpers:

- `Ok`
- `Err`
- `AnthropicErr`
- `FormatErrorPayload`
- `FormatAnthropicErrorPayload`

Avoid manual error type mapping.

## Zod Rules

- validate at route/controller edge
- use `z.infer`
- modularize schemas under `packages/types/src/schemas/`
- avoid loose assertions/casts

## Type Safety

- no `any`
- avoid loose `unknown`
- explicit return types
- DB types must match schema

## Database Rules

SQLite expectations:

- parameterized queries only
- preserve WAL behavior
- migrations update `DB-MIGRATION.md`
- avoid raw SQL interpolation
