//! API-key domain types, record storage, and request authorization helpers.

pub mod access;
pub mod model;
pub mod store;

pub use access::{ensure_model_allowed, is_model_allowed, normalize_model_id};
pub use model::{APIKeyRecord, APIPrincipal, AuthSource};
pub use store::{APIKeyStore, EmptyAPIKeyStore};
