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

1. **Pure `snake_case` Standard**:
   - All schema properties must be strictly `snake_case` (`base_url`, `api_key`, `rate_limit`, `quota_limit`, `usage_tokens`, `require_api_key`, `created_at`).
   - Match SQLite table columns 1:1 without case conversions.
2. **Derived Types Only**:
   - Always derive types using `export type Foo = z.infer<typeof FooSchema>;`.
   - Never write hand-crafted duplicate TypeScript interfaces.
3. **Validation at the Boundary**:
   - Schemas are consumed by Hono routes (`@hono/zod-validator`) in `apps/api` and form validators in `apps/web`.
4. **No Side Effects**:
   - `@srouter/types` contains only Zod schemas and type definitions. No runtime logic, IO, or network access.
