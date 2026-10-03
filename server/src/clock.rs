//! Wall-clock helper shared by session validation and record timestamps.
//! Milliseconds since the Unix epoch, matching the Node runtime's `Date.now()`.

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}
