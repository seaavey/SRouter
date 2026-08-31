# Coding Conventions

## PascalCase Enforcement

Use PascalCase for:

- controllers
- routers
- middleware
- helpers
- logic methods
- domain variables
- Zod schemas and derived types (`APIKeySchema`, `CreateProviderSchema`, `APIKeyZod`)

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

## Zod & Data Contract Rules

- validate at route/controller edge using `@hono/zod-validator`
- use `z.infer<typeof Schema>` for all derived TypeScript types (never hand-write duplicate interfaces)
- modularize schemas under `packages/types/src/schemas/`
- **Schema Casing Law**: All API payload and response contract fields must be pure `snake_case` (`base_url`, `api_key`, `rate_limit`, `usage_tokens`, `require_api_key`) matching SQLite table columns 1:1.
- avoid loose assertions/casts

## Type Safety

- no `any` around JSON boundaries; validate at edge with Zod
- avoid loose `unknown`
- explicit return types on controllers and public package methods
- DB mappers in `@srouter/db` must 1:1 match SQLite table columns without case mutations

## Database Rules

SQLite expectations:

- parameterized queries only
- preserve WAL behavior
- migrations update `DB-MIGRATION.md`
- avoid raw SQL interpolation
