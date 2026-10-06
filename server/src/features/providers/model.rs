//! Provider domain models shared by the catalog and provider-detail responses.

use serde::{Deserialize, Serialize};

/// A model offered by a provider, as listed by the model catalog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelDefinition {
    pub id: &'static str,
    pub name: &'static str,
}

/// An OpenAI-compatible model entry served by `GET /v1/models`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelObject {
    pub id: String,
    pub object: String,
    pub owned_by: String,
}

impl ModelObject {
    pub fn new(id: String, owned_by: String) -> Self {
        Self {
            id,
            object: String::from("model"),
            owned_by,
        }
    }
}

/// The wire protocol a provider speaks, as the catalog and the provider-auth
/// responses report it.
///
/// Three variants, matching what the build actually serves. Node's
/// `ProviderProtocol` union also lists `gemini`, but that value is dead: its only
/// user was the `gemini_cli` provider deleted with `packages/providers/src/catalog.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderProtocol {
    OpenAI,
    Anthropic,
    Custom,
}

/// Provider metadata shared by the catalog and provider-detail responses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProviderMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub protocol: ProviderProtocol,
    pub base_url: &'static str,
    pub web_url: &'static str,
    pub alias: &'static str,
    pub requires_api_key: bool,
    pub requires_oauth: bool,
    pub supports_custom_url: bool,
    pub status_message: &'static str,
}
