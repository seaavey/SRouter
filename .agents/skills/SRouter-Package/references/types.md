# @srouter/types

Canonical contract layer defining Zod schemas and derived TypeScript types for the entire monorepo.

## Directory Layout

```text
packages/types/src/
├── schemas/
│   ├── admin.ts       # AdminChangePasswordSchema, AdminLoginSchema, etc.
│   ├── anthropic.ts   # Anthropic request & response schemas
│   ├── apiKeys.ts     # APIKeySchema, CreateAPIKeySchema, UpdateAPIKeySchema
│   ├── auth.ts        # OAuthCallbackBodySchema, TokenImportBodySchema
│   ├── chat.ts        # ChatCompletionRequestSchema, ChatMessageSchema
│   ├── models.ts      # ModelListResponseSchema, AddCustomModelSchema
│   ├── providers.ts   # CreateProviderSchema, VerifyProviderSchema
│   └── settings.ts    # SettingsSchema, UpdateSettingsSchema
└── index.ts           # Re-exports all schemas and derived types
```

## Contract Rules

1. **Strict `PascalCase` Naming Law (Zero Exceptions)**:
   - **All Zod Schema Constants** MUST be named in **`PascalCase`** (e.g., `APIKeySchema`, `CreateAPIKeySchema`, `UpdateAPIKeySchema`, `APIKeyZod`, `VerifyProviderSchema`, `ChatMessageSchema`, `AdminLoginSchema`).
   - **All Exported Types** MUST be named in **`PascalCase`** (e.g., `APIKey`, `CreateAPIKeyInput`, `VerifyProviderInput`, `ChatCompletionRequest`).
   - **Strictly Banned**: `camelCase` (e.g. `createApiKeySchema`), `snake_case` (e.g. `api_key_schema`), or lowercase aliases.

2. **Pure `snake_case` Property Fields**:
   - While schema and type identifiers are strictly `PascalCase`, all internal JSON/database object property keys MUST be pure `snake_case` (`base_url`, `api_key`, `rate_limit`, `quota_limit`, `usage_tokens`, `require_api_key`, `created_at`).
   - Match SQLite table columns 1:1 without case conversions.

3. **Derived Types Only & Utility Types Reuse**:
   - Always derive types directly from schemas using `export type Foo = z.infer<typeof FooSchema>;`.
   - Never write hand-crafted duplicate TypeScript interfaces that mirror Zod schemas.
   - Reuse existing types via TypeScript utility types (`Pick`, `Omit`, `Partial`) and Zod schema utilities (`.partial()`, `.pick()`, `.omit()`, `.extend()`) rather than re-declaring overlapping properties.
   - For auth token structures (`OAuthTokens`, `TokenImportParams`, etc.), enforce pure `snake_case` property fields (`access_token`, `refresh_token`, `id_token`, `expires_in`, `account_id`) with zero camelCase duplicates or dual aliases.
   - Zero `unknown` / `any` tolerance: use strict typed structures such as `JSONValue`, `JSONObject`, or `JSONSchemaValue` instead of `Record<string, unknown>`.

4. **Validation at the Boundary**:
   - Schemas are consumed by Hono routes (`@hono/zod-validator`) in `apps/api` and form validators in `apps/web`.

5. **No Side Effects**:
   - `@srouter/types` contains only Zod schemas and type definitions. No runtime logic, IO, or network access.
