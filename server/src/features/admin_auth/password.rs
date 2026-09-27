//! Admin password hashing kept byte-compatible with the Node runtime:
//! `scrypt$N$r$p$salt$hash`, where salt and hash are unpadded base64url. A hash
//! minted here must verify under Node's `verifyAdminPassword` and vice versa.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use crate::error::APIError;

const ALGORITHM: &str = "scrypt";
const HASH_LENGTH: usize = 64;
const SALT_LENGTH: usize = 16;
/// Node uses N = 16384; scrypt's `Params` takes log2(N).
const SCRYPT_LOG_N: u8 = 14;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;

/// Validates a candidate password the way `validateAdminPassword` does. Returns
/// the message to report, or `None` when acceptable.
pub fn validate_admin_password(password: &str) -> Option<&'static str> {
    if password.is_empty() {
        return Some("Password is required");
    }
    // Node compares `String.length`, i.e. UTF-16 code units.
    if password.encode_utf16().count() > 128 {
        return Some("Password must be at most 128 characters");
    }

    None
}

/// Mints a salted scrypt hash in the Node string format.
pub fn hash_admin_password(password: &str) -> Result<String, APIError> {
    let mut salt = [0u8; SALT_LENGTH];
    getrandom::fill(&mut salt)
        .map_err(|error| APIError::new(500, format!("could not salt the password: {error}")))?;

    let derived = derive(
        password,
        &salt,
        SCRYPT_LOG_N,
        SCRYPT_R,
        SCRYPT_P,
        HASH_LENGTH,
    )?;

    Ok(format!(
        "{ALGORITHM}${}${SCRYPT_R}${SCRYPT_P}${}${}",
        1u64 << SCRYPT_LOG_N,
        URL_SAFE_NO_PAD.encode(salt),
        URL_SAFE_NO_PAD.encode(derived)
    ))
}

/// Verifies a password against a stored hash. Any malformed input is a failed
/// verification, never an error, matching Node.
pub fn verify_admin_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 6 || parts[0] != ALGORITHM {
        return false;
    }

    let (Ok(n), Ok(r), Ok(p)) = (
        parts[1].parse::<u64>(),
        parts[2].parse::<u32>(),
        parts[3].parse::<u32>(),
    ) else {
        return false;
    };
    if r == 0 || p == 0 || n < 2 || !n.is_power_of_two() {
        return false;
    }
    let log_n = n.trailing_zeros() as u8;

    let (Ok(salt), Ok(expected)) = (
        URL_SAFE_NO_PAD.decode(parts[4]),
        URL_SAFE_NO_PAD.decode(parts[5]),
    ) else {
        return false;
    };
    if salt.is_empty() || expected.is_empty() {
        return false;
    }

    let Ok(actual) = derive(password, &salt, log_n, r, p, expected.len()) else {
        return false;
    };

    constant_time_eq(&actual, &expected)
}

fn derive(
    password: &str,
    salt: &[u8],
    log_n: u8,
    r: u32,
    p: u32,
    length: usize,
) -> Result<Vec<u8>, APIError> {
    let params = scrypt::Params::new(log_n, r, p)
        .map_err(|error| APIError::new(500, format!("invalid scrypt parameters: {error}")))?;
    let mut output = vec![0u8; length];
    scrypt::scrypt(password.as_bytes(), salt, &params, &mut output)
        .map_err(|error| APIError::new(500, format!("scrypt failed: {error}")))?;

    Ok(output)
}

/// Length-checked comparison that does not short-circuit on the first mismatch.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.iter()
        .zip(right)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::{hash_admin_password, validate_admin_password, verify_admin_password};

    #[test]
    fn a_minted_hash_round_trips_and_rejects_the_wrong_password() {
        let hash = hash_admin_password("correct horse").unwrap();

        assert!(hash.starts_with("scrypt$16384$8$1$"));
        assert!(verify_admin_password("correct horse", &hash));
        assert!(!verify_admin_password("wrong horse", &hash));
    }

    #[test]
    fn a_hash_verifies_independently_of_the_original_salt() {
        let first = hash_admin_password("same password").unwrap();
        let second = hash_admin_password("same password").unwrap();

        assert_ne!(first, second);
        assert!(verify_admin_password("same password", &first));
        assert!(verify_admin_password("same password", &second));
    }

    #[test]
    fn malformed_hashes_fail_without_panicking() {
        for stored in [
            "",
            "not-a-hash",
            "scrypt$16384$8$1$onlyfive",
            "bcrypt$16384$8$1$AAAA$AAAA",
            "scrypt$16383$8$1$AAAA$AAAA",
            "scrypt$16384$0$1$AAAA$AAAA",
            "scrypt$16384$8$1$!!!!$AAAA",
        ] {
            assert!(!verify_admin_password("whatever", stored), "{stored}");
        }
    }

    #[test]
    fn password_validation_matches_the_node_rules() {
        assert_eq!(validate_admin_password(""), Some("Password is required"));
        assert_eq!(validate_admin_password("ok"), None);
        assert_eq!(
            validate_admin_password(&"a".repeat(129)),
            Some("Password must be at most 128 characters")
        );
    }
}
