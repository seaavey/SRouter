//! Qoder credentials and machine identity: the values the COSY signature and
//! the request bodies are built from.

use super::cosy::CosyIdentity;
use super::executor::QoderExecutor;
use super::state::{read_opt, write_opt};
use super::types::QODER_PROVIDER;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::rotation::round_robin_enabled;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{QoderCredentials, load_qoder_credentials};
use crate::infrastructure::database::settings::{get_setting, set_setting};

impl QoderExecutor {
    /// Every enabled Qoder account whose device token is still valid, newest
    /// first. The failover loop rotates over this list; a request that only
    /// needs one account asks for the first pick instead.
    pub(super) async fn candidates(&self) -> Result<Vec<QoderCredentials>, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let connections = load_qoder_credentials(database).await?;

        if connections.is_empty() {
            return Err(APIError::new(
                401,
                constants::providers::qoder::NOT_CONNECTED,
            ));
        }

        let now = now_ms();
        let usable: Vec<QoderCredentials> = connections
            .into_iter()
            .filter(|credentials| !credentials.is_expired(now))
            .collect();

        if usable.is_empty() {
            return Err(APIError::new(
                401,
                constants::providers::qoder::TOKEN_EXPIRED,
            ));
        }

        Ok(usable)
    }

    /// The stored Qoder credentials, refused when the token has lapsed. Several
    /// accounts rotate; a lapsed one is passed over so a live sibling serves the
    /// request instead.
    pub(super) async fn credentials(&self) -> Result<QoderCredentials, APIError> {
        let candidates = self.candidates().await?;
        self.pick_account(&candidates).await
    }

    /// Rotates onto one of `candidates`, newest first, skipping a rate-limited
    /// account. Falls back to the newest when every account is cooling, because
    /// serving the request beats waiting out a cooldown that may no longer hold.
    pub(super) async fn pick_account(
        &self,
        candidates: &[QoderCredentials],
    ) -> Result<QoderCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let enabled = round_robin_enabled(database, QODER_PROVIDER.id).await;
        let ids: Vec<String> = candidates
            .iter()
            .map(|credentials| credentials.id.clone())
            .collect();

        Ok(candidates[self.rotator.choose(enabled, &ids)].clone())
    }

    /// The machine id the COSY headers carry, cached for the life of the
    /// adapter so one request does not re-read it.
    pub(super) async fn machine_id(&self) -> Result<String, APIError> {
        if let Some(cached) = read_opt(&self.machine_id) {
            return Ok(cached);
        }

        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let machine_id = machine_id_for(database).await?;

        *write_opt(&self.machine_id) = Some(machine_id.clone());

        Ok(machine_id)
    }
}

/// The machine id stored for this install, generated on first use. Both the
/// executor and the device-flow login read it, so the browser and the signed
/// requests present the same machine.
pub async fn machine_id_for(database: &AppDatabase) -> Result<String, APIError> {
    let setting = crate::features::providers::qoder::types::QODER_MACHINE_ID_SETTING;
    if let Some(stored) = get_setting(database, setting).await?
        && !stored.trim().is_empty()
    {
        return Ok(stored);
    }

    let generated = uuid::Uuid::new_v4().simple().to_string();
    set_setting(database, setting, &generated).await?;

    Ok(generated)
}

pub(super) fn identity<'a>(
    credentials: &'a QoderCredentials,
    machine_id: &'a str,
) -> CosyIdentity<'a> {
    CosyIdentity {
        uid: &credentials.user_id,
        auth_token: &credentials.access_token,
        name: &credentials.name,
        email: &credentials.email,
        machine_id,
    }
}
