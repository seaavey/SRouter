//! Account rotation across a provider's enabled connections, plus the cooldown
//! a `429` leaves behind. One instance per provider executor: the registry
//! stores a clone of the adapter per lookup key, and those clones share the
//! `Arc` this type is held in, so they rotate over one index.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::settings::get_setting;

/// How long a rate-limited connection is passed over. Fixed rather than read
/// from `Retry-After`, because recovering from a `429` is availability, not
/// fairness, and a fixed window needs no per-provider parsing.
const COOLDOWN: Duration = Duration::from_secs(60);

/// The settings key an operator writes to switch rotation off for one provider,
/// spelled the way the Node build spells it.
const ROUND_ROBIN_SETTING_PREFIX: &str = "round_robin_";

/// Rotation index and cooldown deadlines for one provider's connections.
#[derive(Default)]
pub struct AccountRotator {
    state: Mutex<Rotation>,
}

#[derive(Default)]
struct Rotation {
    next: usize,
    /// Keyed by the `providers` row id, valued with the instant it may be tried
    /// again. A restart drops this, which costs at most one retried request.
    cooldowns: HashMap<String, Instant>,
}

impl AccountRotator {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Picks the connection to try, as an index into `connection_ids`, which is
    /// ordered newest first. Cooling rows are skipped; when every row is
    /// cooling the newest is returned anyway, because serving the request beats
    /// waiting out a cooldown that may no longer hold.
    pub fn choose(&self, enabled: bool, connection_ids: &[String]) -> usize {
        if connection_ids.len() <= 1 {
            return 0;
        }

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        let ready: Vec<usize> = (0..connection_ids.len())
            .filter(|index| !state.is_cooling(&connection_ids[*index], now))
            .collect();

        if ready.is_empty() {
            return 0;
        }
        // Rotation off, or only one account left to try: the newest row.
        if !enabled || ready.len() == 1 {
            return ready[0];
        }

        let index = ready[state.next % ready.len()];
        state.next = state.next.wrapping_add(1);

        index
    }

    /// Marks one connection rate-limited, so the next pick reaches another
    /// account. Stays active whatever the rotation flag says, since skipping a
    /// limited account is recovery rather than a preference.
    pub fn cool(&self, connection_id: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .cooldowns
            .insert(connection_id.to_owned(), Instant::now() + COOLDOWN);
    }
}

impl Rotation {
    fn is_cooling(&self, connection_id: &str, now: Instant) -> bool {
        self.cooldowns
            .get(connection_id)
            .is_some_and(|until| *until > now)
    }
}

/// Whether rotation is on for a provider. A missing row reads as on: rotation
/// is the point of a provider with more than one account, so the flag exists as
/// an escape hatch rather than as a setup step. Node defaults it off; the Rust
/// build deliberately does not, which is recorded in the contract.
pub async fn round_robin_enabled(database: &AppDatabase, base_id: &str) -> bool {
    let key = format!("{ROUND_ROBIN_SETTING_PREFIX}{base_id}");

    match get_setting(database, &key).await {
        Ok(Some(value)) => value == "true",
        Ok(None) | Err(_) => true,
    }
}

/// Whether a provider error is an upstream rate limit. The adapters flatten an
/// upstream status into the frozen `500` envelope and keep the status inside
/// the message, so that marker is what a failover loop can match on without a
/// second error channel.
pub fn is_rate_limited(error: &APIError) -> bool {
    error.message().contains("(429)")
}

#[cfg(test)]
mod tests {
    use super::AccountRotator;

    fn ids(count: usize) -> Vec<String> {
        (0..count).map(|index| format!("account-{index}")).collect()
    }

    #[test]
    fn enabled_rotation_walks_every_connection_in_order() {
        let rotator = AccountRotator::default();
        let connections = ids(3);

        let picked = (0..6)
            .map(|_| rotator.choose(true, &connections))
            .collect::<Vec<_>>();

        assert_eq!(picked, [0, 1, 2, 0, 1, 2]);
    }

    #[test]
    fn a_cooling_connection_is_skipped() {
        let rotator = AccountRotator::default();
        let connections = ids(3);
        rotator.cool(&connections[1]);

        let picked = (0..4)
            .map(|_| rotator.choose(true, &connections))
            .collect::<Vec<_>>();

        assert_eq!(picked, [0, 2, 0, 2]);
    }

    #[test]
    fn an_all_cooling_provider_still_picks_the_newest() {
        let rotator = AccountRotator::default();
        let connections = ids(2);
        for connection in &connections {
            rotator.cool(connection);
        }

        assert_eq!(rotator.choose(true, &connections), 0);
        assert_eq!(rotator.choose(false, &connections), 0);
    }

    #[test]
    fn a_disabled_flag_pins_the_newest_ready_connection() {
        let rotator = AccountRotator::default();
        let connections = ids(3);

        let picked = (0..4)
            .map(|_| rotator.choose(false, &connections))
            .collect::<Vec<_>>();

        assert_eq!(picked, [0, 0, 0, 0]);
    }

    #[test]
    fn a_disabled_flag_still_skips_a_cooling_newest_connection() {
        let rotator = AccountRotator::default();
        let connections = ids(3);
        rotator.cool(&connections[0]);

        assert_eq!(rotator.choose(false, &connections), 1);
    }

    #[test]
    fn a_shrunken_connection_list_stays_in_range() {
        let rotator = AccountRotator::default();
        let connections = ids(3);

        assert_eq!(rotator.choose(true, &connections), 0);
        assert_eq!(rotator.choose(true, &connections), 1);

        let shrunk = ids(1);
        assert_eq!(rotator.choose(true, &shrunk), 0);

        let empty: Vec<String> = Vec::new();
        assert_eq!(rotator.choose(true, &empty), 0);
    }

    #[test]
    fn a_single_connection_never_rotates() {
        let rotator = AccountRotator::default();
        let connections = ids(1);

        let picked = (0..3)
            .map(|_| rotator.choose(true, &connections))
            .collect::<Vec<_>>();

        assert_eq!(picked, [0, 0, 0]);
    }
}
