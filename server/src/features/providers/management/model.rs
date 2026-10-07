//! Response types behind the provider management routes. They are built from
//! the static provider seed; the registry stays the source of advertised models.

use std::collections::HashSet;

use serde::Serialize;

use crate::features::providers::{ModelObject, ProviderMetadata, ProviderProtocol};
use crate::infrastructure::database::providers::ProviderConnection;

/// A provider as the list, catalog, and detail routes describe it.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct ProviderEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub protocol: ProviderProtocol,
    pub default_base_url: &'static str,
    pub requires_api_key: bool,
    pub requires_oauth: bool,
    pub supports_custom_url: bool,
    pub enabled: bool,
    /// Whether requests rotate across this provider's accounts.
    pub round_robin: bool,
    pub status: ProviderStatus,
    /// Detail only; the list and catalog omit it like Node does.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub connections: Option<Vec<ProviderConnectionView>>,
    pub models: Vec<ProviderModel>,
}

impl ProviderEntry {
    /// Builds the entry for a provider driver. `connected_count` counts live
    /// connections only, never seed rows.
    pub fn from_metadata(
        metadata: ProviderMetadata,
        enabled: bool,
        connected_count: usize,
    ) -> Self {
        Self {
            id: metadata.id,
            name: metadata.name,
            category: metadata.category,
            protocol: metadata.protocol,
            default_base_url: metadata.base_url,
            requires_api_key: metadata.requires_api_key,
            requires_oauth: metadata.requires_oauth,
            supports_custom_url: metadata.supports_custom_url,
            enabled,
            round_robin: true,
            status: ProviderStatus::new(metadata.status_message, connected_count),
            connections: None,
            models: Vec::new(),
        }
    }

    /// Sets the stored rotation flag. A provider whose row is absent reads as
    /// on, matching the executor's own default.
    pub fn with_round_robin(mut self, enabled: bool) -> Self {
        self.round_robin = enabled;

        self
    }

    /// Attaches the detail-only payload.
    pub fn with_details(
        mut self,
        connections: Vec<ProviderConnectionView>,
        models: Vec<ProviderModel>,
    ) -> Self {
        self.connections = Some(connections);
        self.models = models;

        self
    }
}

/// The two connection states [`ProviderStatus::new`] can report. Rendered as a
/// closed union because the value is computed from the connection count, never
/// read from storage.
struct ProviderState;

impl specta::Type for ProviderState {
    fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
        specta::datatype::DataType::Reference(specta_typescript::define(
            "\"connected\" | \"no_connections\"",
        ))
    }
}

/// Connection state of a provider driver.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct ProviderStatus {
    #[specta(type = ProviderState)]
    pub state: &'static str,
    pub message: &'static str,
    #[specta(type = specta_typescript::Number)]
    pub connected_count: usize,
}

impl ProviderStatus {
    pub fn new(message: &'static str, connected_count: usize) -> Self {
        Self {
            state: if connected_count > 0 {
                "connected"
            } else {
                "no_connections"
            },
            message,
            connected_count,
        }
    }
}

/// A model line in the detail response. Hidden and favorited models stay in the
/// list so the admin view can restore them; `GET /v1/models` is the route that
/// drops them.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct ProviderModel {
    pub id: String,
    pub object: String,
    pub owned_by: String,
    pub hidden: bool,
    pub favorite: bool,
}

impl ProviderModel {
    pub fn from_model(
        model: &ModelObject,
        hidden: &HashSet<String>,
        favorites: &HashSet<String>,
    ) -> Self {
        let normalized = model.id.to_lowercase();

        Self {
            id: model.id.clone(),
            object: model.object.clone(),
            owned_by: model.owned_by.clone(),
            hidden: hidden.contains(&normalized),
            favorite: favorites.contains(&normalized),
        }
    }
}

/// A connection as the detail response reports it. There is deliberately no
/// credential field: a stored API key never leaves the database.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct ProviderConnectionView {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub alias: Option<String>,
    pub category: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub enabled: bool,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

impl From<&ProviderConnection> for ProviderConnectionView {
    fn from(connection: &ProviderConnection) -> Self {
        Self {
            id: connection.id.clone(),
            provider_id: connection.provider_id.clone(),
            name: connection.name.clone(),
            alias: connection.alias.clone(),
            category: connection.category.clone(),
            protocol: connection.protocol.clone(),
            base_url: connection.base_url.clone(),
            enabled: connection.enabled,
            created_at: connection.created_at,
        }
    }
}

/// `GET /v1/providers/catalog`.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct CatalogResponse {
    #[specta(type = specta_typescript::Number)]
    pub total: usize,
    pub categories: GroupedCatalog,
}

/// The four fixed provider groups.
#[derive(Clone, Debug, Default, Serialize, specta::Type)]
pub struct GroupedCatalog {
    pub oauth: Vec<ProviderEntry>,
    pub free_tier: Vec<ProviderEntry>,
    pub api_key: Vec<ProviderEntry>,
    pub custom_provider: Vec<ProviderEntry>,
}

impl GroupedCatalog {
    /// Buckets an entry by its category; an unknown category is dropped the way
    /// the four fixed groups do.
    pub fn push(&mut self, entry: ProviderEntry) {
        match entry.category {
            "oauth" => self.oauth.push(entry),
            "free_tier" => self.free_tier.push(entry),
            "api_key" => self.api_key.push(entry),
            "custom_provider" => self.custom_provider.push(entry),
            _ => {}
        }
    }
}
