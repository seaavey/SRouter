//! In-flight provider OAuth sessions: the state, its PKCE verifier, and the
//! claim lifecycle the device flow needs.
//!
//! A session is claimed while one caller talks to the upstream, so a second
//! poll cannot exchange the same state twice. The caller releases the claim
//! when the upstream is not ready yet and deletes the row once the tokens are
//! stored. Rows older than [`SESSION_TTL_MS`] are refused on claim, and every
//! login sweeps the stale ones.

use sqlx::{Row, sqlite::SqliteRow};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;

/// How long a half-finished login stays claimable.
pub const SESSION_TTL_MS: i64 = 15 * 60 * 1000;

/// One stored OAuth session, without any secret beyond the PKCE verifier the
/// exchange itself needs.
#[derive(Clone, Debug)]
pub struct OAuthSession {
    pub state: String,
    pub code_verifier: String,
    /// The upstream device code a device-flow poll needs. A redirect flow
    /// leaves it unset; the Cline flow stores it at login time.
    pub device_code: Option<String>,
    pub client_id: String,
    pub redirect_uri: String,
    pub created_at: i64,
    pub claimed_at: Option<i64>,
}

/// Stores a new session for a login that has just started.
pub async fn save_session(
    database: &AppDatabase,
    state: &str,
    code_verifier: &str,
    client_id: &str,
    redirect_uri: &str,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;

    sqlx::query(
        "INSERT INTO oauth_sessions (state, code_verifier, device_code, client_id, redirect_uri, created_at, claimed_at) \
         VALUES (?, ?, NULL, ?, ?, ?, NULL)",
    )
    .bind(state)
    .bind(code_verifier)
    .bind(client_id)
    .bind(redirect_uri)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the OAuth session", error),
        )
    })?;

    Ok(())
}

/// Stores a device-flow session, whose poll reads the upstream device code
/// instead of a PKCE verifier.
pub async fn save_device_session(
    database: &AppDatabase,
    state: &str,
    device_code: &str,
    client_id: &str,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;

    sqlx::query(
        "INSERT INTO oauth_sessions (state, code_verifier, device_code, client_id, redirect_uri, created_at, claimed_at) \
         VALUES (?, '', ?, ?, '', ?, NULL)",
    )
    .bind(state)
    .bind(device_code)
    .bind(client_id)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the OAuth device session", error),
        )
    })?;

    Ok(())
}

/// Marks the session as in use and returns it. An unknown, expired, or already
/// claimed state reads as `None`, which the route reports as "pending".
pub async fn claim_session(
    database: &AppDatabase,
    state: &str,
) -> Result<Option<OAuthSession>, APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;
    let now = now_ms();
    let cutoff = now - SESSION_TTL_MS;

    let claimed = sqlx::query(
        "UPDATE oauth_sessions SET claimed_at = ? \
         WHERE state = ? AND claimed_at IS NULL AND created_at >= ?",
    )
    .bind(now)
    .bind(state)
    .bind(cutoff)
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("claim the OAuth session", error),
        )
    })?
    .rows_affected();

    if claimed == 0 {
        return Ok(None);
    }

    let row = sqlx::query(
        "SELECT state, code_verifier, device_code, client_id, redirect_uri, created_at, claimed_at \
         FROM oauth_sessions WHERE state = ?",
    )
    .bind(state)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read the OAuth session", error),
        )
    })?;

    row.as_ref().map(session_from_row).transpose()
}

/// Returns the session to the pool so the next poll can claim it again.
pub async fn release_session(database: &AppDatabase, state: &str) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;

    sqlx::query("UPDATE oauth_sessions SET claimed_at = NULL WHERE state = ?")
        .bind(state)
        .execute(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("release the OAuth session", error),
            )
        })?;

    Ok(())
}

/// Consumes the session once its tokens are stored.
pub async fn delete_session(database: &AppDatabase, state: &str) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;

    sqlx::query("DELETE FROM oauth_sessions WHERE state = ?")
        .bind(state)
        .execute(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("delete the OAuth session", error),
            )
        })?;

    Ok(())
}

/// Drops sessions older than `older_than_ms`, called before a login starts.
pub async fn cleanup_expired_sessions(
    database: &AppDatabase,
    older_than_ms: i64,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::OAUTH_SESSIONS_UNSUPPORTED)?;

    sqlx::query("DELETE FROM oauth_sessions WHERE created_at < ?")
        .bind(older_than_ms)
        .execute(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("sweep expired OAuth sessions", error),
            )
        })?;

    Ok(())
}

fn session_from_row(row: &SqliteRow) -> Result<OAuthSession, APIError> {
    let read = |column: &str| {
        row.try_get::<String, _>(column).map_err(|error| {
            APIError::new(500, constants::database::column_unreadable(column, &error))
        })
    };

    Ok(OAuthSession {
        state: read("state")?,
        code_verifier: read("code_verifier")?,
        device_code: row
            .try_get::<Option<String>, _>("device_code")
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::column_unreadable("device_code", &error),
                )
            })?,
        client_id: read("client_id")?,
        redirect_uri: read("redirect_uri")?,
        created_at: row.try_get::<i64, _>("created_at").map_err(|error| {
            APIError::new(
                500,
                constants::database::column_unreadable("created_at", &error),
            )
        })?,
        claimed_at: row
            .try_get::<Option<i64>, _>("claimed_at")
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::column_unreadable("claimed_at", &error),
                )
            })?,
    })
}
