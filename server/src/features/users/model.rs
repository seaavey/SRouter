//! Customer-account domain types and the login-token minting helpers.

use crate::constants;
use crate::error::APIError;

/// Prefix every login token carries, so a leaked one is recognizable as a
/// console credential rather than a gateway key.
const USER_TOKEN_PREFIX: &str = "sr-user-";

/// A stored account. The login token itself is never here: only its hash is
/// persisted, plus this non-secret display prefix.
#[derive(Clone, Debug, PartialEq)]
pub struct User {
    pub id: String,
    pub name: String,
    pub token_prefix: String,
    pub enabled: bool,
    pub created_at: i64,
}

/// A freshly minted account paired with its full login token. The token exists
/// only in this return value; creation and rotation are the two responses that
/// can carry it.
#[derive(Clone, Debug, PartialEq)]
pub struct CreatedUser {
    pub user: User,
    pub token: String,
}

/// Fields accepted by `POST /v1/users`.
#[derive(Clone, Debug, PartialEq, specta::Type)]
pub struct CreateUserInput {
    pub name: String,
}

/// Partial update accepted by `PATCH /v1/users/:id`. Absent fields are left
/// untouched.
#[derive(Clone, Debug, Default, PartialEq, specta::Type)]
pub struct UpdateUserInput {
    #[specta(optional)]
    pub name: Option<String>,
    #[specta(optional)]
    pub enabled: Option<bool>,
}

/// Mints a login token: `sr-user-` followed by 32 hex characters, the same
/// shown-once shape as an API key.
pub fn generate_user_token() -> Result<String, APIError> {
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes)?;

    Ok(format!("{USER_TOKEN_PREFIX}{}", hex::encode(bytes)))
}

/// Mints an account id with the `usr_` prefix, so a user id cannot be mistaken
/// for the `key_` id an API key carries.
pub fn generate_user_id() -> Result<String, APIError> {
    let mut bytes = [0u8; 12];
    fill_random(&mut bytes)?;

    Ok(format!("usr_{}", hex::encode(bytes)))
}

/// The first eight characters of a token, matching `key_prefix_of`; the full
/// token is never stored.
pub fn user_token_prefix_of(token: &str) -> String {
    token.chars().take(8).collect()
}

fn fill_random(bytes: &mut [u8]) -> Result<(), APIError> {
    getrandom::fill(bytes)
        .map_err(|error| APIError::new(500, constants::users::could_not_generate_token(error)))
}

#[cfg(test)]
mod tests {
    use super::{generate_user_id, generate_user_token, user_token_prefix_of};

    #[test]
    fn generated_tokens_carry_the_user_prefix_and_the_display_prefix_matches() {
        let token = generate_user_token().unwrap();

        assert!(token.starts_with("sr-user-"));
        assert_eq!(token.len(), "sr-user-".len() + 32);
        assert_eq!(user_token_prefix_of(&token), "sr-user-");
    }

    #[test]
    fn generated_ids_carry_the_user_prefix_and_are_unique() {
        let first = generate_user_id().unwrap();
        let second = generate_user_id().unwrap();

        assert!(first.starts_with("usr_"));
        assert_eq!(first.len(), "usr_".len() + 24);
        assert_ne!(first, second);
    }
}
