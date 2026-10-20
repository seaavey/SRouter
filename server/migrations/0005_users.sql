-- SRouter schema v5: customer accounts, their console sessions, and the API keys
-- they own. Applied by src/infrastructure/database/migrations.rs inside the same
-- transaction as the rest of the schema run, which then records
-- PRAGMA user_version = 5.

CREATE TABLE IF NOT EXISTS users (
    id           TEXT    PRIMARY KEY,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL UNIQUE,  -- lowercase sha256 hex of the login token
    token_prefix TEXT    NOT NULL,         -- non-secret display prefix, 'sr-user-'
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL
);

-- NULL = an operator key minted by an older build; it keeps working and belongs
-- to nobody, so no customer ever sees it.
ALTER TABLE api_keys ADD COLUMN user_id TEXT REFERENCES users (id);

-- The session table now holds both audiences: NULL user_id is the operator, a
-- user id is a customer console session.
ALTER TABLE admin_sessions RENAME TO auth_sessions;
ALTER TABLE auth_sessions ADD COLUMN user_id TEXT REFERENCES users (id);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
