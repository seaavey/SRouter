//! Custom providers: a user-registered endpoint added over HTTP, serving the
//! OpenAI chat-completions protocol or the Anthropic Messages protocol from a
//! bare `providers` row.
//!
//! Node seeds one executor per saved row (`loadSavedProvidersFromDB`). The Rust
//! build registers a single generic executor per custom row at boot and after
//! every write, because the row itself carries everything the driver needs: its
//! UUID, alias, base URL, protocol, and credentials. Unlike the built-in
//! drivers nothing is compiled in, so a row deleted from the database stops
//! resolving as soon as the registry drops it.
//!
//! The model catalog is live: it reads `GET {base_url}/models`, the same call
//! the Node `OpenAIExecutor` and `AnthropicExecutor` make, and caches it on a
//! short TTL so a catalog write does not hit upstream on every request.

pub mod catalog;
pub mod executor;
pub mod registry;

pub use crate::infrastructure::database::providers::{
    CustomProviderRow, NewCustomProvider, create_custom_provider, delete_custom_provider,
    find_custom_provider, list_custom_providers,
};
pub use executor::{CustomProvider, ProviderShape, adapter, adapter_from_row};
pub use registry::{
    refresh_custom_provider, register_custom_providers, unregister_custom_provider,
};
