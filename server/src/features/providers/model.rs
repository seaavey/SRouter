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

/// Provider metadata shared by the catalog and provider-detail responses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProviderMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub protocol: &'static str,
    pub base_url: &'static str,
    pub web_url: &'static str,
    pub alias: &'static str,
    pub requires_api_key: bool,
    pub requires_oauth: bool,
    pub supports_custom_url: bool,
    pub status_message: &'static str,
}
