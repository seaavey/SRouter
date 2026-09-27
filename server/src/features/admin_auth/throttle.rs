//! Admin login throttle: five failures from one client address block further
//! attempts for 15 minutes, mirroring the Node route's in-process map.

use std::collections::HashMap;
use std::sync::Mutex;

const MAX_FAILURES: u32 = 5;
const BLOCK_MS: i64 = 15 * 60 * 1000;

#[derive(Debug)]
struct Failure {
    count: u32,
    blocked_until: i64,
}

/// Process-wide login throttle shared by every admin router mount.
#[derive(Debug)]
pub struct LoginThrottle {
    failures: Mutex<HashMap<String, Failure>>,
    max_failures: u32,
    block_ms: i64,
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::with_policy(MAX_FAILURES, BLOCK_MS)
    }

    pub fn with_policy(max_failures: u32, block_ms: i64) -> Self {
        Self {
            failures: Mutex::new(HashMap::new()),
            max_failures,
            block_ms,
        }
    }

    /// Reports whether the address is currently blocked, dropping an expired
    /// block first so a later attempt starts from a clean slate.
    pub fn is_blocked(&self, address: &str, now_ms: i64) -> bool {
        let mut failures = self.lock();

        match failures.get(address) {
            Some(failure) if failure.blocked_until > now_ms => true,
            Some(failure) if failure.blocked_until > 0 => {
                failures.remove(address);
                false
            }
            _ => false,
        }
    }

    /// Records one failed attempt, starting the block on the nth failure.
    pub fn record_failure(&self, address: &str, now_ms: i64) {
        let mut failures = self.lock();
        let count = failures.get(address).map_or(0, |failure| failure.count) + 1;
        let blocked_until = if count >= self.max_failures {
            now_ms + self.block_ms
        } else {
            0
        };

        failures.insert(
            address.to_owned(),
            Failure {
                count,
                blocked_until,
            },
        );
    }

    /// Clears the counter after a successful login.
    pub fn clear(&self, address: &str) {
        self.lock().remove(address);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Failure>> {
        self.failures
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::LoginThrottle;

    #[test]
    fn the_fifth_failure_blocks_for_the_configured_window() {
        let throttle = LoginThrottle::new();
        let address = "203.0.113.7";

        for _ in 0..4 {
            throttle.record_failure(address, 1_000);
        }
        assert!(!throttle.is_blocked(address, 1_000));

        throttle.record_failure(address, 1_000);
        assert!(throttle.is_blocked(address, 1_000));
        assert!(throttle.is_blocked(address, 1_000 + 15 * 60 * 1000 - 1));
        assert!(!throttle.is_blocked(address, 1_000 + 15 * 60 * 1000));
    }

    #[test]
    fn a_successful_login_clears_the_counter() {
        let throttle = LoginThrottle::new();
        let address = "203.0.113.7";

        for _ in 0..4 {
            throttle.record_failure(address, 1_000);
        }
        throttle.clear(address);
        throttle.record_failure(address, 1_000);

        assert!(!throttle.is_blocked(address, 1_000));
    }

    #[test]
    fn addresses_are_throttled_independently() {
        let throttle = LoginThrottle::new();

        for _ in 0..5 {
            throttle.record_failure("203.0.113.7", 1_000);
        }

        assert!(throttle.is_blocked("203.0.113.7", 1_000));
        assert!(!throttle.is_blocked("198.51.100.9", 1_000));
    }
}
