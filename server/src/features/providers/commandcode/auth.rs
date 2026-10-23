//! Command Code credentials and the CLI header set.
//!
//! There is deliberately no refresh: the sign-in hands back a static key with no
//! expiry the gateway can trust, so an expired key surfaces as an upstream 401
//! and the operator reconnects.

use std::collections::BTreeMap;

use super::executor::CommandCodeExecutor;
use super::types::COMMANDCODE_CLI_VERSION;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::providers::{
    CommandCodeCredentials, load_commandcode_credentials,
};

impl CommandCodeExecutor {
    pub(super) async fn credentials(&self) -> Result<CommandCodeCredentials, APIError> {
        let database = self.database.as_ref().ok_or_else(|| {
            APIError::new(500, constants::providers::commandcode::DATABASE_REQUIRED)
        })?;

        load_commandcode_credentials(database, self.id())
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::commandcode::NOT_CONNECTED))
    }

    /// The header vocabulary the CLI sends, minus the per-request
    /// `Content-Type`, `Authorization`, and `x-session-id`.
    pub(super) fn base_headers(&self) -> BTreeMap<&'static str, String> {
        let mut headers = BTreeMap::new();
        headers.insert("User-Agent", "cli".to_owned());
        headers.insert("x-command-code-version", COMMANDCODE_CLI_VERSION.to_owned());
        headers.insert("x-cli-environment", "production".to_owned());
        // The CLI's taste-learning and co-flag switches are off for a gateway:
        // neither has a workspace to learn from.
        headers.insert("x-taste-learning", "false".to_owned());
        headers.insert("x-co-flag", "false".to_owned());
        headers
    }
}
