//! Fixed-window rate limit keyed by API key ID plus client address, matching
//! the frozen Node middleware (`apps/api/src/middleware/RateLimit.ts`).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Request, State};
use axum::http::{HeaderValue, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::APIError;
use crate::features::api_keys::APIPrincipal;
use crate::state::AppState;

use super::client_address::client_address;

/// Requests per 60-second window; a key with `rate_limit = 0` is unlimited.
const WINDOW_MS: i64 = 60_000;
/// Cap on tracked windows; expired entries are dropped once exceeded.
const MAX_TRACKED_KEYS: usize = 10_000;

#[derive(Debug)]
struct Window {
    count: u32,
    reset_at: i64,
}

/// Process-wide fixed-window limiter shared by both gateway mounts.
#[derive(Debug)]
pub struct RateLimiter {
    windows: Mutex<HashMap<String, Window>>,
    max_tracked: usize,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::with_max_tracked(MAX_TRACKED_KEYS)
    }

    pub fn with_max_tracked(max_tracked: usize) -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            max_tracked,
        }
    }

    /// Records one request. Returns `None` when the request is allowed and
    /// `Some(retry_after_seconds)` when it exceeds the limit.
    pub fn check(&self, window_key: &str, limit: u32, now_ms: i64) -> Option<u64> {
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        // Mirror Node: once the cap is exceeded, drop only expired windows.
        if windows.len() > self.max_tracked {
            windows.retain(|_, entry| entry.reset_at > now_ms);
        }

        match windows.get_mut(window_key) {
            Some(entry) if entry.reset_at > now_ms => {
                entry.count += 1;

                if entry.count > limit {
                    let remaining_ms = (entry.reset_at - now_ms).max(0);

                    // ceil(remaining_ms / 1000), never below one second.
                    return Some((((remaining_ms + 999) / 1000).max(1)) as u64);
                }

                None
            }
            _ => {
                windows.insert(
                    window_key.to_owned(),
                    Window {
                        count: 1,
                        reset_at: now_ms + WINDOW_MS,
                    },
                );

                None
            }
        }
    }

    pub fn tracked_windows(&self) -> usize {
        self.windows
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }
}

/// Enforces the per-key limit. Runs after authentication so it can read the
/// key record from the request extensions.
pub async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let record = request
        .extensions()
        .get::<APIPrincipal>()
        .and_then(|principal| principal.api_key.as_ref());

    let Some(record) = record else {
        return next.run(request).await;
    };
    if record.rate_limit == 0 {
        return next.run(request).await;
    }

    let address = client_address(request.extensions()).unwrap_or_else(|| "unknown".to_owned());
    let window_key = format!("{}:{}", record.id, address);
    let limit = record.rate_limit;

    match state
        .security
        .rate_limiter
        .check(&window_key, limit, now_ms())
    {
        Some(retry_after) => rate_limit_error(limit, retry_after).into_response(),
        None => next.run(request).await,
    }
}

fn rate_limit_error(limit: u32, retry_after_seconds: u64) -> Response {
    let mut error = APIError::new(
        429,
        format!(
            "Rate limit exceeded: this API key allows {limit} request{} per minute.",
            if limit == 1 { "" } else { "s" }
        ),
    )
    .with_code("rate_limit_exceeded")
    .into_response();

    if let Ok(value) = HeaderValue::from_str(&retry_after_seconds.to_string()) {
        error.headers_mut().insert(header::RETRY_AFTER, value);
    }

    error
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::RateLimiter;

    #[test]
    fn requests_up_to_the_limit_pass() {
        let limiter = RateLimiter::new();

        for _ in 0..3 {
            assert_eq!(limiter.check("key_1:203.0.113.7", 3, 1_000_000), None);
        }
    }

    #[test]
    fn the_request_over_the_limit_returns_the_retry_after() {
        let limiter = RateLimiter::new();

        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_000), None);
        // 60 seconds remain of the window that started at 1_000_000.
        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_000), Some(60));
        // One second of the window left rounds up to a 1 second wait.
        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_059_001), Some(1));
    }

    #[test]
    fn the_window_resets_after_sixty_seconds() {
        let limiter = RateLimiter::new();

        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_000), None);
        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_001), Some(60));
        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_060_001), None);
    }

    #[test]
    fn windows_are_isolated_per_key_and_address() {
        let limiter = RateLimiter::new();

        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_000), None);
        assert_eq!(limiter.check("key_1:203.0.113.7", 1, 1_000_001), Some(60));
        assert_eq!(limiter.check("key_2:203.0.113.7", 1, 1_000_001), None);
        assert_eq!(limiter.check("key_1:198.51.100.9", 1, 1_000_001), None);
    }

    #[test]
    fn expired_windows_are_evicted_above_the_cap() {
        let limiter = RateLimiter::with_max_tracked(2);

        for index in 0..4 {
            let key = format!("key_{index}:203.0.113.7");
            assert_eq!(limiter.check(&key, 1, 0), None);
        }
        assert!(limiter.tracked_windows() > 2);

        // Every window has expired, so the next request drops them all.
        assert_eq!(limiter.check("key_4:203.0.113.7", 1, 120_000), None);
        assert_eq!(limiter.tracked_windows(), 1);
    }
}
