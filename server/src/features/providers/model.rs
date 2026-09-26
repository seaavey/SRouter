//! Provider domain models shared by the catalog and provider-detail responses.

/// A model offered by a provider, as listed by the model catalog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelDefinition {
    pub id: &'static str,
    pub name: &'static str,
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
