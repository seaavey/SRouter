# @srouter/db

Native SQLite persistence layer (`node:sqlite`) running in WAL mode with connection reuse and full parameterization.

## Directory Layout

```text
packages/db/src/
├── db.ts              # Database connection singleton, WAL pragmas, schema init
├── apiKeys.ts         # API Key CRUD, quota deduction, credit validation
├── providers.ts       # Provider connections, credentials, metadata queries
├── customModels.ts    # Custom model registration and queries
├── fallbacks.ts       # Model combo and fallback cascade rules
├── settings.ts        # Global gateway settings (require_api_key, etc.)
├── logs.ts            # Request/response audit traces and usage logs
├── OAuthSessions.ts   # OAuth state and temporary token tracking
├── quota.ts           # Rate limit counters and usage metrics
├── tokenSaver.ts      # Token optimization metrics
├── row-utils.ts       # Row parsing and deserialization helpers
└── index.ts           # Barrel export
```

## Database Rules

1. **Parameterization Law**:
   - Every single query MUST use `?` parameter placeholders: `db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id)`.
   - String concatenation or template literals in SQL queries are strictly forbidden.
2. **Schema Casing & Mappings**:
   - Table columns use `snake_case`.
   - Mappers in `row-utils.ts` convert raw SQLite rows directly to `snake_case` type contracts without case alteration.
3. **Migrations**:
   - When modifying or adding tables, document the schema diff in `DB-MIGRATION.md`.
4. **Transactions**:
   - Use `db.transaction()` for multi-step operations (e.g. key deletion + log cleanup, credit deduction).
