# SRouter database schema v2 (Rust migration)

**Status:** Proposed schema contract for the Rust persistence layer. Derived from the observed
Node/SQLite schema (disposable-probe dump documented out of band) plus API-visible behavior in
`docs/api-v1-contract.md`. Not yet applied to any database; Task 6 (SQLx stores) stays blocked
until this contract is approved via the persistence gate in `docs/api-database-contract.md`.

Scope: SQLite is the primary target. No PostgreSQL-only feature is used, no ORM is assumed, and
no speculative feature is added.

## 1. Design principles

1. **One table per domain concept with its own lifecycle and queries** (keys, providers, logs,
   sessions) — not per abstract relation. The v1 schema has 12 tables; v2 has 10.
2. **Relational columns for data queried per field; JSON for blobs that are always read and
   written whole** (provider credentials and metadata). JSON is not used for the whole schema.
3. **Hash secrets at rest wherever reversibility is not required.** `api_keys.key` becomes a
   sha256 lookup hash; admin password (scrypt) and admin session tokens (sha256) already are
   hashed and stay unchanged. Upstream provider credentials stay plaintext because they must be
   replayed to upstream APIs.
4. **SQLite-native idioms:** epoch-millisecond `INTEGER` timestamps, `INTEGER 0/1` booleans,
   schema version via `PRAGMA user_version`, composite primary keys for natural uniqueness, and
   **no foreign keys** (v1 declares none either; request logs must outlive deleted keys and
   providers).
5. **Constraints only where they protect data:** `NOT NULL` + `DEFAULT` on counters and flags,
   `CHECK (id = 1)` for singletons, no speculative columns.
6. **`updated_at` only where it has real purpose:** `admin_accounts` (password rotation) is the
   only table where an update timestamp means something.
7. **`request_logs` stays one practical operational log.** Writes are append-only and reads are
   aggregate; splitting it into child tables would only add joins.
8. **`settings` is a deliberate key/value table.** It has genuine domain purpose: the frozen
   `/v1/settings` contract accepts arbitrary string settings from clients, and runtime keys
   (`require_api_key`, `round_robin_*`, `provider_enabled_*`, tunnel config) are dynamic by
   nature. This is not a generic metadata dumping ground.

## 2. Table-by-table decisions

| v1 table                          | Decision     | Rationale                                                                                                                                                                       |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_account`                   | **rename**   | → `admin_accounts` for consistent plural naming. Row shape unchanged (singleton `CHECK (id = 1)`; `updated_at` kept for password rotation).                                     |
| `admin_sessions`                  | **remain**   | Already minimal: `token_hash, created_at, expires_at`. Auth check is a primary-key lookup.                                                                                      |
| `api_keys`                        | **simplify** | `key` → `key_hash` (sha256 hex, `UNIQUE`) + `key_prefix` (non-secret display prefix). Numeric columns tightened to `NOT NULL DEFAULT`. All counters/limits stay.                |
| `providers`                       | **simplify** | 18 → 11 columns. Seven credential columns move into JSON `credentials`; `custom_headers` and `provider_specific_data` move into JSON `meta`. Core columns remain.               |
| `custom_models` + `hidden_models` | **merge**    | → `provider_model_overrides(provider_id, model_id, custom, hidden, created_at)`. Same shape and meaning ("user adjustment to a provider's model list"). Composite PK preserved. |
| `favorite_models`                 | **remain**   | Favorites are global (no provider) and cannot fold into a per-provider table without changing semantics.                                                                        |
| `fallback_rules`                  | **remain**   | Already clean; only `max_retries` tightened to `NOT NULL DEFAULT 1`.                                                                                                            |
| `oauth_sessions`                  | **remain**   | Real OAuth/PKCE domain; seven columns are exactly what the flow needs.                                                                                                          |
| `request_logs`                    | **remain**   | Kept as one wide practical log; see §7-G for why `fallback_occurred` and `total_tokens` are deliberately kept.                                                                  |
| `system_settings`                 | **rename**   | → `settings` for consistent naming; key/value content is domain data (§1-8).                                                                                                    |
| `srouter_schema_meta`             | **remove**   | Replaced by `PRAGMA user_version` (SQLite-native versioning, zero tables).                                                                                                      |

No new tables. Removed: `custom_models`, `hidden_models`, `srouter_schema_meta`.

### The merge rule for `provider_model_overrides`

A row exists **iff** `custom = 1 OR hidden = 1` (otherwise it is deleted):

| State                  | `custom` | `hidden` |
| ---------------------- | -------- | -------- |
| user-added model shown | 1        | 0        |
| catalog model hidden   | 0        | 1        |
| user-added and hidden  | 1        | 1        |

Two flags — not a single visibility enum — because v1 allows a model to be present in both
`custom_models` and `hidden_models` at the same time, and that combination must remain
representable after migration.

## 3. Complete `CREATE TABLE` statements (v2)

```sql
-- Singleton admin account (bootstrap password, stored as scrypt hash).
CREATE TABLE admin_accounts (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

-- Admin login sessions (raw token lives in the cookie; only its sha256 is stored).
CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Gateway API keys; the secret itself is never stored.
CREATE TABLE api_keys (
    id             TEXT    PRIMARY KEY,
    key_hash       TEXT    NOT NULL UNIQUE,   -- lowercase sha256 hex of the full key
    key_prefix     TEXT    NOT NULL,          -- non-secret display prefix, e.g. 'sr-live-'
    name           TEXT    NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,     -- 0/1
    rate_limit     INTEGER NOT NULL DEFAULT 0,     -- requests per 60s window; 0 = unlimited
    quota_limit    INTEGER NOT NULL DEFAULT 0,     -- token quota; 0 = unlimited
    usage_tokens   INTEGER NOT NULL DEFAULT 0,
    credit_limit   REAL    NOT NULL DEFAULT 0,     -- fractional credit; 0 = unlimited
    usage_cost     REAL    NOT NULL DEFAULT 0,
    allowed_models TEXT,                           -- JSON array of model ids; NULL = all
    created_at     INTEGER NOT NULL
);

-- Provider connections (secrets and provider-specific data stored as JSON).
CREATE TABLE providers (
    id          TEXT    PRIMARY KEY,
    provider_id TEXT    NOT NULL,                  -- base driver id, e.g. 'openai'
    name        TEXT    NOT NULL,
    alias       TEXT,
    category    TEXT    NOT NULL,
    protocol    TEXT    NOT NULL,
    base_url    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,        -- this connection's enabled state
    credentials TEXT    NOT NULL DEFAULT '{}',     -- JSON: api_key, access_token, refresh_token,
                                                  --       token_expires_at, last_refreshed_at,
                                                  --       account_id, organization_id
    meta        TEXT    NOT NULL DEFAULT '{}',     -- JSON: custom_headers,
                                                  --       provider_specific_data
                                                  --       (seed marker, driver-specific fields)
    created_at  INTEGER NOT NULL
);

-- Per-provider model-list overrides: added (custom) and/or hidden.
CREATE TABLE provider_model_overrides (
    provider_id TEXT    NOT NULL,
    model_id    TEXT    NOT NULL,
    custom      INTEGER NOT NULL DEFAULT 0,        -- 0/1; row exists iff custom=1 OR hidden=1
    hidden      INTEGER NOT NULL DEFAULT 0,        -- 0/1
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider_id, model_id)
);

-- Globally favorite models (no provider dimension).
CREATE TABLE favorite_models (
    model_id   TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

-- Model-to-model fallback rules.
CREATE TABLE fallback_rules (
    id                TEXT    PRIMARY KEY,
    source_model      TEXT    NOT NULL,
    target_model      TEXT    NOT NULL,
    priority          INTEGER NOT NULL DEFAULT 1,
    enabled           INTEGER NOT NULL DEFAULT 1,
    trigger_on_status TEXT,                        -- JSON array of status codes; NULL = any
    max_retries       INTEGER NOT NULL DEFAULT 1,
    created_at        INTEGER NOT NULL
);

-- In-flight provider OAuth flows (authorization-code/PKCE and device flow).
CREATE TABLE oauth_sessions (
    state         TEXT    PRIMARY KEY,
    code_verifier TEXT    NOT NULL,
    device_code   TEXT,
    client_id     TEXT    NOT NULL,
    redirect_uri  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    claimed_at    INTEGER                          -- set once the flow is redeemed
);

-- Operational request log (single append-only table).
CREATE TABLE request_logs (
    id                    TEXT    PRIMARY KEY,
    api_key_id            TEXT,
    ip_address            TEXT,
    user_agent            TEXT,
    provider_id           TEXT    NOT NULL,
    model                 TEXT    NOT NULL,
    prompt_tokens         INTEGER NOT NULL DEFAULT 0,
    completion_tokens     INTEGER NOT NULL DEFAULT 0,
    total_tokens          INTEGER NOT NULL DEFAULT 0,
    status_code           INTEGER NOT NULL,
    latency_ms            INTEGER NOT NULL,
    cached_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
    estimated_cost        REAL    NOT NULL DEFAULT 0,
    fallback_occurred     INTEGER NOT NULL DEFAULT 0,
    fallback_path         TEXT,
    fallback_reason       TEXT,
    resolved_model        TEXT,
    created_at            INTEGER NOT NULL
);

-- Runtime configuration (domain key/value store exposed by /v1/settings).
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Connection pragmas and version gate

Run on every connection / boot:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;      -- no FKs are declared; kept for future-proofing only
-- schema version lives here, not in a table:
PRAGMA user_version;           -- 0/1 = legacy v1 data, 2 = v2, >2 = refuse to open
```

Fresh installs create all tables above and set `PRAGMA user_version = 2`.

## 4. Indexes (necessary only)

```sql
-- Auth lookup for api_keys: WHERE key_hash = ? AND enabled = 1 (from UNIQUE below)
CREATE UNIQUE INDEX idx_api_keys_key_hash     ON api_keys (key_hash);

-- request_logs: recent list, time-window analytics, per-provider usage, per-model usage
CREATE INDEX idx_request_logs_created         ON request_logs (created_at);
CREATE INDEX idx_request_logs_provider        ON request_logs (provider_id, created_at);
CREATE INDEX idx_request_logs_model           ON request_logs (model);

-- fallback_rules: canonical load order (priority ASC, created_at ASC)
CREATE INDEX idx_fallback_priority            ON fallback_rules (priority, created_at);
```

Dropped from v1, with reasons:

| v1 index                            | Why it is not needed in v2                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `idx_providers_provider_id`         | The table holds dozens of rows; the real query also uses `LOWER(provider_id)`, which no plain column index serves anyway. |
| `idx_custom_models_provider`        | Covered by the `provider_model_overrides` composite PK prefix (`provider_id, ...`).                                       |
| `idx_hidden_models_provider`        | Same as above.                                                                                                            |
| `idx_favorite_models_created`       | Tiny table; ordering happens in the application.                                                                          |
| `idx_request_logs_provider_model`   | Provider-filtered aggregations use `idx_request_logs_provider`; model grouping runs on that subset.                       |
| session/oauth expiry indexes        | Small tables; `DELETE ... WHERE expires_at/created_at <= ?` scans are cheap.                                              |
| (none on `request_logs.api_key_id`) | `api_key_id` is never used in a `WHERE` today; add only when per-key stats exist.                                         |

## 5. Old → new mapping

### Tables

| v1 table              | v2 table                   | Transform                                                                                                                                                  |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_account`       | `admin_accounts`           | `ALTER TABLE ... RENAME TO`.                                                                                                                               |
| `admin_sessions`      | `admin_sessions`           | Straight copy.                                                                                                                                             |
| `api_keys`            | `api_keys`                 | Rebuild: `key` → `key_hash` (sha256, computed in application code) + `key_prefix` = `substr(key,1,8)`; `COALESCE` all nullable numerics to their defaults. |
| `providers`           | `providers`                | Rebuild: seven credential columns → JSON `credentials`; `custom_headers` + `provider_specific_data` → JSON `meta`; remaining columns copied as-is.         |
| `custom_models`       | `provider_model_overrides` | Rows become `custom = 1, hidden = 0`.                                                                                                                      |
| `hidden_models`       | `provider_model_overrides` | Rows become `custom = 0, hidden = 1`; rows present in both tables collapse to `custom = 1, hidden = 1`.                                                    |
| `favorite_models`     | `favorite_models`          | Straight copy.                                                                                                                                             |
| `fallback_rules`      | `fallback_rules`           | Copy; `max_retries` NULL → `1`.                                                                                                                            |
| `oauth_sessions`      | `oauth_sessions`           | Straight copy.                                                                                                                                             |
| `request_logs`        | `request_logs`             | Straight copy (historical analytics stay intact).                                                                                                          |
| `system_settings`     | `settings`                 | `ALTER TABLE ... RENAME TO`.                                                                                                                               |
| `srouter_schema_meta` | —                          | Read `schema_version` for provenance, then `DROP TABLE`; version becomes `PRAGMA user_version`.                                                            |

### Column-level mapping (changed tables only)

| v1                                                        | v2                                                                | Notes                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `api_keys.key`                                            | `api_keys.key_hash` + `api_keys.key_prefix`                       | One-way; see §7-B. `key_prefix` is `substr(key,1,8)` = `sr-live-` (no secret entropy). |
| `api_keys.rate_limit/quota_limit/usage_tokens` (nullable) | same, `NOT NULL DEFAULT 0`                                        | `0` remains the "unlimited" sentinel from the API contract.                            |
| `api_keys.credit_limit/usage_cost`                        | same, `NOT NULL DEFAULT 0`                                        | Stay `REAL`/`f64` (fractional values exist).                                           |
| `api_keys.allowed_models`                                 | same                                                              | `NULL` = all models; empty array normalized to `NULL` as in v1.                        |
| `providers.api_key`                                       | `providers.credentials` (JSON, `api_key`)                         | Moved into the JSON blob; read/written as a whole.                                     |
| `providers.access_token/refresh_token`                    | `providers.credentials` (`access_token`, `refresh_token`)         | Token refresh becomes read-modify-write of one row.                                    |
| `providers.token_expires_at/last_refreshed_at`            | `providers.credentials` (`token_expires_at`, `last_refreshed_at`) | Never used in a `WHERE` clause; safe inside JSON.                                      |
| `providers.account_id/organization_id`                    | `providers.credentials` (`account_id`, `organization_id`)         | Request identity data sent as upstream headers.                                        |
| `providers.custom_headers`                                | `providers.meta.custom_headers`                                   | Lifted as-is (already JSON text).                                                      |
| `providers.provider_specific_data`                        | `providers.meta.provider_specific_data`                           | Includes the seed marker; every reader must move to `meta`.                            |
| `providers.enabled`                                       | same                                                              | Per-connection flag; **not** merged with settings keys `provider_enabled_*`.           |
| `custom_models.(provider_id, model_id)`                   | `provider_model_overrides.(provider_id, model_id)` + `custom = 1` | Composite PK preserved.                                                                |
| `hidden_models.(provider_id, model_id)`                   | idem + `hidden = 1`                                               | Overlap rows become `custom = 1, hidden = 1`.                                          |
| `system_settings.key/value`                               | `settings.key/value`                                              | Keys unchanged: `require_api_key`, `round_robin_*`, `provider_enabled_*`, tunnel keys. |
| `srouter_schema_meta('schema_version','1')`               | `PRAGMA user_version = 2`                                         | See §7-F.                                                                              |

## 6. Migration procedure (v1 → v2)

Order of operations, all inside one transaction after a file backup and `PRAGMA wal_checkpoint`:

1. **Guard:** read `user_version`; if `0` or `1`, and `srouter_schema_meta.schema_version` exists,
   treat the file as v1. If `2`, nothing to do. If `>2`, refuse to open.
2. **Renames** (SQLite metadata-only, instant):

    ```sql
    ALTER TABLE admin_account   RENAME TO admin_accounts;
    ALTER TABLE system_settings RENAME TO settings;
    ```

3. **`provider_model_overrides`** (pure SQL union; overlap handled by `GROUP BY`):

    ```sql
    CREATE TABLE provider_model_overrides (
        provider_id TEXT    NOT NULL,
        model_id    TEXT    NOT NULL,
        custom      INTEGER NOT NULL DEFAULT 0,
        hidden      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (provider_id, model_id)
    );

    INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at)
    SELECT provider_id, model_id, MAX(custom), MAX(hidden), MIN(created_at)
    FROM (
        SELECT provider_id, model_id, 1 AS custom, 0 AS hidden, created_at FROM custom_models
        UNION ALL
        SELECT provider_id, model_id, 0 AS custom, 1 AS hidden, created_at FROM hidden_models
    )
    GROUP BY provider_id, model_id;

    DROP TABLE custom_models;
    DROP TABLE hidden_models;
    ```

4. **`api_keys` rebuild** — SQLite has no built-in sha256 (and neither does `node:sqlite`), so
   the hash is computed in application code, one row at a time:

    ```sql
    CREATE TABLE api_keys_v2 ( ...full v2 DDL from §3... );

    -- per old row (application computes key_hash = sha256(lowercase hex)):
    INSERT INTO api_keys_v2 (id, key_hash, key_prefix, name, enabled, rate_limit, quota_limit,
                             usage_tokens, credit_limit, usage_cost, allowed_models, created_at)
    VALUES (?, ?, substr(?, 1, 8), ?,
            COALESCE(?, 1), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0),
            COALESCE(?, 0), COALESCE(?, 0), ?, ?);
    --            ^ bound params come from the old row
    ```

    Then `DROP TABLE api_keys; ALTER TABLE api_keys_v2 RENAME TO api_keys;` and recreate
    `idx_api_keys_key_hash`.

5. **`providers` rebuild** — application reads each row, validates existing JSON in
   `custom_headers`/`provider_specific_data` (fall back to `{}` on parse failure), assembles the
   `credentials` and `meta` JSON objects, and inserts into `providers_v2`; then drop + rename.
6. **`fallback_rules`**: `UPDATE fallback_rules SET max_retries = 1 WHERE max_retries IS NULL;`
   before re-creating the table with `NOT NULL` (SQLite cannot add `NOT NULL` via `ALTER`), or
   rebuild like the tables above.
7. **Straight-copy tables** (`admin_sessions`, `favorite_models`, `oauth_sessions`,
   `request_logs`) are untouched.
8. **Version:** `DROP TABLE srouter_schema_meta;` then `PRAGMA user_version = 2;` after commit.
9. **Verify:** row counts per table match expectations; spot-check one migrated key (auth via
   hash) and one merged override row; refuse to proceed on any mismatch (leave the file at v1).

SQLite cannot add `NOT NULL`/`UNIQUE` in place, so every tightening above uses the standard
rebuild pattern: create new table → `INSERT ... SELECT` with `COALESCE` → drop old → rename —
all in the single transaction from step 1.

## 7. Migration and compatibility considerations

- **A. The migration is one-way; run it at cutover with the Node process stopped.** Node cannot
  operate on a v2 file: `SELECT ... FROM api_keys WHERE key = ?` fails (`no such column`), and
  Node's schema init would re-create renamed/dropped tables (`custom_models`, `hidden_models`,
  `system_settings`) empty, making saved preferences look missing from Node's side. **Tradeoff:**
  a Node+Rust shadow period sharing one v2 file is unsafe — shadow comparisons must use a copy of
  the database plus a dry-run of the migrator. Take a backup first.
- **B. Hashing `api_keys.key` deliberately changes observable behavior.** After migration
  `GET /v1/keys` can no longer return full key values, so the dashboard's copy-from-list and
  search-by-key-text features must move to name/id/prefix matching (`maskKey()` renders
  `sr-live-••••`; no last-4 is stored because that would store secret material).
  `POST /v1/keys` still returns the full key **once, at creation**. The frozen contract
  (`docs/api-v1-contract.md`) only fixes `{object:"list", data:[...]}` without item shape, but
  this behavioral change requires explicit sign-off. Alternatives if copy must keep working:
  keep plaintext (rejected by the hashing requirement) or re-issue all keys.
- **C. Hashes are computed in application code, not SQL.** sha256 hex (lowercase) per key.
  An unsalted sha256 is adequate for high-entropy random secrets; the Rust side should mint
  longer keys than v1 (e.g. 32 hex chars) when generating new ones.
- **D. Tightening constraints requires table rebuilds** (see §6). Never run `ALTER TABLE` tricks
  outside the single guarded transaction with a backup.
- **E. The custom+hidden merge must keep two flags.** A single visibility enum would lose the
  "user-added model that is currently hidden" state, which v1 can represent and uses (the hidden
  filter runs after custom models are merged). Application-level quirk deliberately preserved:
  the global model list filters hidden models by `model_id` only, ignoring `provider_id` — that
  is app logic, not schema, and must keep behaving the same.
- **F. `srouter_schema_meta` → `PRAGMA user_version`.** Node's export/import validation checks
  the marker table, so v2 files are **rejected** by Node's import validator; conversely Rust must
  recognize v1 backups (marker present) and run this migrator before trusting them. **PostgreSQL
  tradeoff:** `PRAGMA user_version` does not exist on PostgreSQL; if the `DATABASE_URL` path ever
  becomes real, it needs its own version carrier — deliberately not designed now (no
  speculation).
- **G. No foreign keys, on purpose.** Deleting an API key or provider must not delete request
  history. v1 ran with `foreign_keys = 0` and no declared FKs; adding FKs to an existing SQLite
  file is expensive and risky, so v2 matches current behavior. Rust still enables the pragma
  (harmless no-op).
- **H. `request_logs` keeps every v1 column.** `total_tokens` stays denormalized because the
  dashboard sums it; `fallback_occurred` stays because `fallback_path` may be empty even when a
  fallback happened, so the flag is not derivable from `path IS NOT NULL`.
- **I. Provider toggles stay split, matching v1 semantics.** `providers.enabled` is
  per-connection; settings keys `provider_enabled_*` and `round_robin_*` are per **base**
  provider and may apply to multiple connections — folding them into a column would change
  multi-connection behavior.
- **J. Node-side consumers to update at cutover (not during shadow):** `packages/db` transfer
  validation (expects exact v1 columns incl. `srouter_schema_meta`), CLI `srouter migrate`
  (copies tables by name), and web UI key display/search.
- **K. Connection behavior in Rust:** gate on `user_version` before any query; treat `0/1` as
  legacy (run §6), `2` as ready, `>2` as an error.

## 8. Rust type recommendations

Row structs via `#[derive(sqlx::FromRow)]` (no ORM), converted to domain types at the edge:

```rust
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct APIKeyRow {
    pub id: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub name: String,
    pub enabled: bool,
    pub rate_limit: i64,     // domain: u32, 0 = unlimited
    pub quota_limit: i64,    // domain: u32, 0 = unlimited
    pub usage_tokens: i64,   // domain: u64
    pub credit_limit: f64,   // domain: f64 (fractional values are real)
    pub usage_cost: f64,
    pub allowed_models: Option<String>, // domain: Option<Vec<String>>
    pub created_at: i64,     // epoch milliseconds
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCredentials {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub token_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub last_refreshed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub organization_id: Option<String>,
}
```

| Column kind                                                                                                     | Row type (SQLx)  | Domain type                        | Notes                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ids, hashes, prefixes, names                                                                                    | `String`         | `String` or newtype                | Prefixed ids (`key_...`, `log_...`) stay `String`.                                                                                    |
| `created_at`, `expires_at`, `token_expires_at`                                                                  | `i64`            | `i64` epoch **ms**                 | `is_expired(now) = expires_at > now` — same comparison as v1.                                                                         |
| `enabled`, `custom`, `hidden`, `fallback_occurred`                                                              | `bool`           | `bool`                             | SQLx maps `INTEGER` 0/1 to `bool` on SQLite.                                                                                          |
| `rate_limit`, `quota_limit`, `usage_tokens`, `priority`, `max_retries`, `status_code`, `latency_ms`, `*_tokens` | `i64`            | `u32`/`u64` via checked conversion | `0` stays the sentinel "unlimited" from the contract — not `Option`.                                                                  |
| `credit_limit`, `usage_cost`, `estimated_cost`                                                                  | `f64`            | `f64`                              | Real values are fractional; do not switch to integer cents (compatibility).                                                           |
| `allowed_models`                                                                                                | `Option<String>` | `Option<Vec<String>>`              | `serde_json`; write path maps `[]` → `NULL`.                                                                                          |
| `credentials`, `meta`                                                                                           | `String`         | typed serde structs                | `#[serde(default)]` everywhere; parse on read, serialize on write.                                                                    |
| `trigger_on_status`                                                                                             | `Option<String>` | `Option<Vec<u16>>`                 | JSON array of status codes; `NULL` = any.                                                                                             |
| `password_hash`                                                                                                 | `String`         | scrypt verifier                    | Keep the v1 string format `scrypt$N$r$p$salt$hash` (N=16384, r=8, p=1) so existing admin hashes verify unchanged — no data migration. |
| `key_hash`                                                                                                      | `String`         | lowercase hex                      | `sha2` + `hex` (already in `Cargo.toml` for session tokens); lookup: `WHERE key_hash = ? AND enabled = 1`.                            |

Insert helpers: a `NewRequestLog` struct with `Default` (all counters default to `0` per the
`DEFAULT` clauses) and a settings upsert of the form
`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`.

## 9. Explicit non-goals

- No foreign keys, cascades, views, triggers, or generated columns.
- No splitting `request_logs`, no per-key or per-day rollup tables (aggregates are computed on
  read at current scale).
- No PostgreSQL-only types (`BIGINT` aliases, `TIMESTAMPTZ`, enums); nothing here fails on
  SQLite.
- No ORM schema annotations or migration DSL — plain SQL files ordered by version and applied
  by a `user_version`-guarded runner.
- No speculative tables for roadmap phases that have not started.
