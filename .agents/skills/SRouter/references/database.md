# Database Reference — @srouter/db

## Table of Contents

1. [Architecture](#architecture)
2. [SQLite Configuration](#sqlite-configuration)
3. [Schema & Tables](#schema--tables)
4. [Repository Pattern](#repository-pattern)
5. [Key Operations](#key-operations)
6. [Working with the DB](#working-with-the-db)

---

## Architecture

`@srouter/db` provides the persistence layer using Node.js 22's native `node:sqlite` (`DatabaseSync`). There are no external database dependencies — everything runs embedded in a single `.db` file.

```
packages/db/src/
├── db.ts               # SQLite instance, WAL config, schema init
├── providers.ts        # Provider connection repository
├── apiKeys.ts          # Virtual API keys repository
├── logs.ts             # Request audit trail & analytics
├── quota.ts            # Live quota fetching & usage tracking
├── fallbacks.ts        # Model fallback rules & wildcard matcher
├── oauthSessions.ts    # OAuth PKCE session store
├── settings.ts         # Key-value system settings
├── tokenSaver.ts       # Token saver configurations
├── adminAuth.ts        # Admin accounts & sessions
└── index.ts            # Package barrel export
```

---

## SQLite Configuration

### Database path resolution:

1. `process.env.DATABASE_PATH`
2. `./apps/api/srouter.db`
3. `./srouter.db`

Parent directories are created automatically.

### PRAGMAs:

```sql
PRAGMA journal_mode = WAL;    -- Write-Ahead Logging for concurrent reads
PRAGMA foreign_keys = ON;
```

WAL mode is critical — it allows concurrent reads during writes without blocking. Don't switch to journal mode.

### Schema migrations:

Tables use `CREATE TABLE IF NOT EXISTS`. Column additions use guarded `ALTER TABLE ... ADD COLUMN` wrapped in try/catch for idempotent evolution.

---

## Schema & Tables

### `providers`

```sql
id TEXT PRIMARY KEY,
provider_id TEXT,
name TEXT,
category TEXT,
protocol TEXT,
base_url TEXT,
api_key TEXT,
access_token TEXT,
refresh_token TEXT,
account_id TEXT,
organization_id TEXT,
provider_specific_data TEXT,    -- JSON blob
token_expires_at INTEGER,
last_refreshed_at INTEGER,
custom_headers TEXT,            -- JSON blob
enabled INTEGER DEFAULT 1,
created_at TEXT
```

### `api_keys`

```sql
id TEXT PRIMARY KEY,
key TEXT UNIQUE,               -- Format: sr-live-{hex16}
name TEXT,
enabled INTEGER DEFAULT 1,
rate_limit INTEGER,
quota_limit INTEGER,
usage_tokens INTEGER DEFAULT 0,
created_at TEXT
```

### `request_logs`

```sql
id TEXT PRIMARY KEY,
api_key_id TEXT,
provider_id TEXT,
model TEXT,
prompt_tokens INTEGER,
completion_tokens INTEGER,
total_tokens INTEGER,
cached_tokens INTEGER,
cache_creation_tokens INTEGER,
reasoning_tokens INTEGER,
estimated_cost REAL,
fallback_occurred INTEGER,
fallback_path TEXT,            -- JSON array of attempted models
fallback_reason TEXT,
resolved_model TEXT,
status_code INTEGER,
latency_ms INTEGER,
created_at TEXT
```

### `oauth_sessions`

```sql
state TEXT PRIMARY KEY,
code_verifier TEXT,
client_id TEXT,
redirect_uri TEXT,
created_at TEXT
```

### `fallback_rules`

```sql
id TEXT PRIMARY KEY,
source_model TEXT,
target_model TEXT,
priority INTEGER,
enabled INTEGER DEFAULT 1,
trigger_on_status TEXT,        -- JSON array of status codes
max_retries INTEGER,
created_at TEXT
```

### `admin_account`

```sql
id INTEGER PRIMARY KEY CHECK(id=1),   -- Single admin
password_hash TEXT,
created_at TEXT,
updated_at TEXT
```

### `admin_sessions`

```sql
token_hash TEXT PRIMARY KEY,           -- SHA-256 of session cookie
created_at TEXT,
expires_at TEXT
```

### `system_settings`

```sql
key TEXT PRIMARY KEY,
value TEXT
```

---

## Repository Pattern

Each table has a dedicated repository file with typed functions:

### Providers (`providers.ts`)

- `getAllProvidersDB()` — All providers
- `getProviderByIdDB(id)` — Single provider
- `getConnectionsByProviderIdDB(providerId)` — All connections for a provider type
- `upsertProviderDB(config)` — Insert or update
- `createProviderDB(config)` — Insert only
- `deleteProviderDB(id)` — Delete
- `updateProviderTokensDB(input)` — Token-only update (for refresh cycles)

### API Keys (`apiKeys.ts`)

- `getAllAPIKeysDB()`, `getAPIKeyByKeyDB(key)`
- `createAPIKeyDB(data)` — Generates `sr-live-{hex16}` key
- `incrementAPIKeyUsageDB(keyId, tokens)` — Atomic usage increment

### Logs (`logs.ts`)

- `logRequestDB(entry)`, `getRecentLogsDB(limit)`
- `getUsageSummaryDB()` — Aggregate token + cost stats
- `getProviderUsageSummaryDB(providerId)`
- `getProviderModelUsageDB(providerId)` — Per-model breakdown
- `getUsageByModelDB()` — Global model usage for billing

### Fallbacks (`fallbacks.ts`)

- CRUD operations + `findMatchingFallbackRulesDB(sourceModel)`
- **Multi-tier matching**:
    1. Exact model match → priority score 1
    2. Wildcard prefix (`anthropic/*`) → priority score 2
    3. Global wildcard (`*`) → priority score 3
- Prevents self-loops, sorted by rule priority ASC

### Quota (`quota.ts`)

- `fetchAntigravityLiveQuota()` — Live Google Cloud Code quota via internal API
- `getProviderQuotaAccount()` — Dispatches between live queries and logged usage

---

## Key Operations

### Creating an API key

```typescript
import { createAPIKeyDB } from "@srouter/db";
const newKey = createAPIKeyDB({
    name: "My App Key",
    rateLimit: 100, // RPM
    quotaLimit: 1000000 // max tokens
});
// newKey.key === "sr-live-a1b2c3d4e5f6g7h8"
```

### Logging a request

```typescript
import { logRequestDB } from "@srouter/db";
logRequestDB({
    apiKeyId: "key-id",
    providerId: "anthropic",
    model: "claude-3-7-sonnet",
    promptTokens: 1500,
    completionTokens: 500,
    totalTokens: 2000,
    estimatedCost: 0.015,
    statusCode: 200,
    latencyMs: 1234
});
```

### Finding fallback rules

```typescript
import { findMatchingFallbackRulesDB } from "@srouter/db";
const rules = findMatchingFallbackRulesDB("anthropic/claude-3-7-sonnet");
// Returns ordered array: exact matches first, then wildcards
```

---

## Working with the DB

### Important constraints:

1. **Single-file database** — All data in one `.db` file. Back up this file to back up everything.
2. **WAL mode** — Creates `.db-wal` and `.db-shm` companion files. Include all three when backing up.
3. **Synchronous API** — `DatabaseSync` is blocking. Queries are fast enough for the gateway's throughput.
4. **No ORM** — Raw SQL with typed helper functions. Keep it that way for performance.
5. **Migrations are additive** — Never drop columns. Always use `ALTER TABLE ... ADD COLUMN` with try/catch.
6. **JSON blobs** — `provider_specific_data`, `custom_headers`, `fallback_path`, `trigger_on_status` are JSON strings. Parse with `JSON.parse()`, store with `JSON.stringify()`.
