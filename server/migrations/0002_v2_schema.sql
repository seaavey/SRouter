-- SRouter schema v2. Source of truth: docs/schemas-database.md (sections 3 and 4).
-- Applied by src/infrastructure/database/migrations.rs, which runs this whole
-- file inside one transaction and then sets PRAGMA user_version = 2.
--
-- Every statement uses IF NOT EXISTS: a legacy v1 database already holds the
-- unchanged tables (admin_sessions, favorite_models, oauth_sessions,
-- request_logs) and may hold renamed tables from the pre-transform step.
-- The file is idempotent by design; never add data statements here.

-- Singleton admin account (bootstrap password, stored as scrypt hash).
CREATE TABLE IF NOT EXISTS admin_accounts (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

-- Admin login sessions (raw token lives in the cookie; only its sha256 is stored).
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Gateway API keys; the secret itself is never stored.
CREATE TABLE IF NOT EXISTS api_keys (
    id             TEXT    PRIMARY KEY,
    key_hash       TEXT    NOT NULL UNIQUE,   -- lowercase sha256 hex of the full key
    key_prefix     TEXT    NOT NULL,          -- non-secret display prefix, e.g. 'sr-live-'
    name           TEXT    NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    rate_limit     INTEGER NOT NULL DEFAULT 0,
    quota_limit    INTEGER NOT NULL DEFAULT 0,
    usage_tokens   INTEGER NOT NULL DEFAULT 0,
    credit_limit   REAL    NOT NULL DEFAULT 0,
    usage_cost     REAL    NOT NULL DEFAULT 0,
    allowed_models TEXT,
    created_at     INTEGER NOT NULL
);

-- Provider connections (secrets and provider-specific data stored as JSON).
CREATE TABLE IF NOT EXISTS providers (
    id          TEXT    PRIMARY KEY,
    provider_id TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    alias       TEXT,
    category    TEXT    NOT NULL,
    protocol    TEXT    NOT NULL,
    base_url    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    credentials TEXT    NOT NULL DEFAULT '{}',
    meta        TEXT    NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL
);

-- Per-provider model-list overrides: added (custom) and/or hidden.
CREATE TABLE IF NOT EXISTS provider_model_overrides (
    provider_id TEXT    NOT NULL,
    model_id    TEXT    NOT NULL,
    custom      INTEGER NOT NULL DEFAULT 0,
    hidden      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider_id, model_id)
);

-- Globally favorite models (no provider dimension).
CREATE TABLE IF NOT EXISTS favorite_models (
    model_id   TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

-- Model-to-model fallback rules.
CREATE TABLE IF NOT EXISTS fallback_rules (
    id                TEXT    PRIMARY KEY,
    source_model      TEXT    NOT NULL,
    target_model      TEXT    NOT NULL,
    priority          INTEGER NOT NULL DEFAULT 1,
    enabled           INTEGER NOT NULL DEFAULT 1,
    trigger_on_status TEXT,
    max_retries       INTEGER NOT NULL DEFAULT 1,
    created_at        INTEGER NOT NULL
);

-- In-flight provider OAuth flows (authorization-code/PKCE and device flow).
CREATE TABLE IF NOT EXISTS oauth_sessions (
    state         TEXT    PRIMARY KEY,
    code_verifier TEXT    NOT NULL,
    device_code   TEXT,
    client_id     TEXT    NOT NULL,
    redirect_uri  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    claimed_at    INTEGER
);

-- Operational request log (single append-only table).
CREATE TABLE IF NOT EXISTS request_logs (
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
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Necessary indexes only; rationale for every dropped v1 index lives in
-- docs/schemas-database.md section 4.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash  ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_request_logs_created      ON request_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider     ON request_logs (provider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model        ON request_logs (model);
CREATE INDEX IF NOT EXISTS idx_fallback_priority         ON fallback_rules (priority, created_at);
