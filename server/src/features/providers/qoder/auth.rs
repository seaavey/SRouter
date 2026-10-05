//! Qoder credentials and machine identity: the values the COSY signature and
//! the request bodies are built from.

use super::cosy::CosyIdentity;
use super::executor::QoderExecutor;
use super::state::{read_opt, write_opt};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{QoderCredentials, load_qoder_credentials};
use crate::infrastructure::database::settings::{get_setting, set_setting};

impl QoderExecutor {
    /// The stored Qoder credentials, refused when the token has lapsed.
    pub(super) async fn credentials(&self) -> Result<QoderCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let credentials = load_qoder_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::qoder::NOT_CONNECTED))?;

        if credentials.is_expired(now_ms()) {
            return Err(APIError::new(
                401,
                constants::providers::qoder::TOKEN_EXPIRED,
            ));
        }

        Ok(credentials)
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
