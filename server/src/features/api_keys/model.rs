//! API-key domain types: the record the auth middleware reads, the management
//! view the CRUD routes return, and the key-generation helpers.

use sha2::{Digest, Sha256};

use crate::error::APIError;

/// Prefix every minted secret carries; the same eight characters make up
/// `key_prefix` in schema v2 (`docs/schemas-database.md` §7-C).
const KEY_SECRET_PREFIX: &str = "sr-live-";

#[derive(Clone, Debug, PartialEq)]
pub struct APIKeyRecord {
    pub id: String,
    pub enabled: bool,
    /// Requests per minute; `0` means unlimited.
    pub rate_limit: u32,
    pub quota_limit: f64,
    pub usage_tokens: f64,
    pub credit_limit: f64,
    pub usage_cost: f64,
    pub allowed_models: Option<Vec<String>>,
}

/// Management view of a stored key. Unlike [`APIKeyRecord`], which the auth
/// middleware reads, this carries the non-secret display prefix and the
/// creation timestamp the management API returns. The secret itself is never
/// stored after creation (`docs/schemas-database.md` §7-B).
#[derive(Clone, Debug, PartialEq)]
pub struct APIKey {
    pub id: String,
    pub key_prefix: String,
    pub name: String,
    pub enabled: bool,
    pub rate_limit: u32,
    pub quota_limit: u32,
    pub usage_tokens: u64,
    pub credit_limit: f64,
    pub usage_cost: f64,
    pub allowed_models: Option<Vec<String>>,
    pub created_at: i64,
}

/// A freshly created key paired with its full secret. The secret exists only in
/// this return value; `POST /v1/keys` is the one response that can carry it.
#[derive(Clone, Debug, PartialEq)]
pub struct CreatedAPIKey {
    pub key: APIKey,
    pub secret: String,
}

/// Fields accepted by `POST /v1/keys`, mirroring `CreateAPIKeySchema`.
#[derive(Clone, Debug, PartialEq)]
pub struct CreateAPIKeyInput {
    pub name: String,
    pub enabled: bool,
    pub rate_limit: u32,
    pub quota_limit: u32,
    pub credit_limit: f64,
    pub allowed_models: Option<Vec<String>>,
}

/// Partial update accepted by `PATCH /v1/keys/:id`. Every field is optional;
/// absent fields are left untouched. `allowed_models` distinguishes absent
/// (`None`) from an explicit clear (`Some(None)`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpdateAPIKeyInput {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub rate_limit: Option<u32>,
    pub quota_limit: Option<u32>,
    pub credit_limit: Option<f64>,
    pub allowed_models: Option<Option<Vec<String>>>,
}

/// Mints a new secret: `sr-live-` followed by 32 hex characters of entropy
/// (longer than v1, per `docs/schemas-database.md` §7-C).
pub fn generate_key_secret() -> Result<String, APIError> {
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes)?;

    Ok(format!("{KEY_SECRET_PREFIX}{}", hex::encode(bytes)))
}

/// Mints a new key id with the `key_` prefix the Node API used.
pub fn generate_key_id() -> Result<String, APIError> {
    let mut bytes = [0u8; 12];
    fill_random(&mut bytes)?;

    Ok(format!("key_{}", hex::encode(bytes)))
}

/// The first eight characters of a secret, matching the v1 migration's
/// `substr(key, 1, 8)` (= `sr-live-`).
pub fn key_prefix_of(secret: &str) -> String {
    secret.chars().take(8).collect()
}

/// Lowercase sha256 hex of the full secret, the only key material stored.
pub fn hash_api_key(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

/// Parses the `allowed_models` TEXT column: `NULL` and an empty array both mean
/// "unrestricted" (`None`).
pub fn parse_allowed_models(raw: Option<&str>) -> Option<Vec<String>> {
    let raw = raw?;
    let parsed = serde_json::from_str::<Vec<String>>(raw).ok()?;

    (!parsed.is_empty()).then_some(parsed)
}

/// Collapses an empty allowlist to `None` ("unrestricted"). Node stores `NULL`
/// and returns `null` for `[]`, so both the value written and the value echoed
/// in a response must normalize the same way (`docs/schemas-database.md` §7-B).
pub fn normalize_allowed_models(models: Option<Vec<String>>) -> Option<Vec<String>> {
    models.filter(|models| !models.is_empty())
}

/// Serializes an allowlist for storage; `None` and an empty list both store SQL
/// `NULL`.
pub fn serialize_allowed_models(models: Option<&[String]>) -> Result<Option<String>, APIError> {
    match normalize_allowed_models(models.map(<[String]>::to_vec)) {
        None => Ok(None),
        Some(models) => serde_json::to_string(&models).map(Some).map_err(|error| {
            APIError::new(500, format!("could not encode allowed_models: {error}"))
        }),
    }
}

fn fill_random(bytes: &mut [u8]) -> Result<(), APIError> {
    getrandom::fill(bytes)
        .map_err(|error| APIError::new(500, format!("could not generate a key secret: {error}")))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthSource {
    AdminSession,
    APIKey,
    Anonymous,
}

/// Which credential authorized the request, plus the key record when one was
/// used. Cloned into request extensions, which is why it derives `Clone`.
#[derive(Clone, Debug)]
pub struct APIPrincipal {
    pub source: AuthSource,
    pub api_key: Option<APIKeyRecord>,
}

#[cfg(test)]
mod tests {
    use super::{
        generate_key_id, generate_key_secret, hash_api_key, key_prefix_of,
        normalize_allowed_models, parse_allowed_models, serialize_allowed_models,
    };

    #[test]
    fn generated_secrets_carry_the_live_prefix_and_the_display_prefix_matches() {
        let secret = generate_key_secret().unwrap();

        assert!(secret.starts_with("sr-live-"));
        assert_eq!(secret.len(), "sr-live-".len() + 32);
        assert_eq!(key_prefix_of(&secret), "sr-live-");
    }

    #[test]
    fn generated_key_ids_carry_the_key_prefix_and_are_unique() {
        let first = generate_key_id().unwrap();
        let second = generate_key_id().unwrap();

        assert!(first.starts_with("key_"));
        assert_ne!(first, second);
    }

    #[test]
    fn hashing_matches_the_node_sha256_hex() {
        // sha256("abc"), the value used for the session-store parity test.
        assert_eq!(
            hash_api_key("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn null_and_empty_allowlists_mean_unrestricted() {
        assert_eq!(parse_allowed_models(None), None);
        assert_eq!(parse_allowed_models(Some("[]")), None);
        assert_eq!(parse_allowed_models(Some("not json")), None);
    }

    #[test]
    fn a_populated_allowlist_round_trips() {
        let models = vec!["gpt-4o".to_owned()];
        let stored = serialize_allowed_models(Some(&models)).unwrap();

        assert_eq!(stored.as_deref(), Some(r#"["gpt-4o"]"#));
        assert_eq!(parse_allowed_models(stored.as_deref()), Some(models));
        assert_eq!(serialize_allowed_models(None).unwrap(), None);
    }

    #[test]
    fn an_empty_allowlist_stores_null_like_node() {
        assert_eq!(serialize_allowed_models(Some(&[])).unwrap(), None);
        assert_eq!(normalize_allowed_models(Some(Vec::new())), None);
        assert_eq!(normalize_allowed_models(None), None);
        assert_eq!(
            normalize_allowed_models(Some(vec!["gpt-4o".to_owned()])),
            Some(vec!["gpt-4o".to_owned()])
        );
    }
}
