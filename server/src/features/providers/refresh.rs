//! The refresh window every OAuth driver follows: how long before an access
//! token expires it is refreshed, and what a driver does when the upstream
//! states no expiry at all.
//!
//! The window and the arithmetic live here because four drivers used to carry
//! their own copy, and two of them spelled the same comparison differently.

/// Refresh this long before the access token expires; mirrors the Node
/// sweeper's lead time (`apps/api/src/services/tokenRefresh.ts`).
pub(crate) const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;

/// Refresh a token with no known expiry once, the Node fallback.
pub(crate) const TOKEN_REFRESH_FALLBACK_MS: i64 = 12 * 60 * 60 * 1000;

/// What a driver does when the stored token states no expiry.
#[derive(Clone, Copy)]
pub(crate) enum NoExpiry {
    /// Refresh once the token was last refreshed longer than the fallback
    /// window ago. Codex and Cline, which record the last refresh.
    Stale,
    /// Refresh on every check until the upstream states an expiry.
    /// Antigravity, whose credential row does not record the last refresh.
    Always,
    /// Use the token until the upstream states an expiry. Claude.
    Never,
}

/// Whether the stored token is due for a refresh.
pub(crate) fn refresh_due(
    expires_at: Option<i64>,
    last_refreshed_at: Option<i64>,
    no_expiry: NoExpiry,
    now: i64,
) -> bool {
    match expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => match no_expiry {
            NoExpiry::Stale => last_refreshed_at
                .is_none_or(|refreshed_at| now - refreshed_at >= TOKEN_REFRESH_FALLBACK_MS),
            NoExpiry::Always => true,
            NoExpiry::Never => false,
        },
    }
}
