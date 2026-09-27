//! API-key domain types, record storage, management CRUD, and request
//! authorization helpers.

pub mod access;
pub mod model;
pub mod repository;
pub mod routes;
pub mod store;

pub use access::{ensure_model_allowed, is_model_allowed, normalize_model_id};
pub use model::{
    APIKey, APIKeyRecord, APIPrincipal, AuthSource, CreateAPIKeyInput, CreatedAPIKey,
    UpdateAPIKeyInput, generate_key_id, generate_key_secret, hash_api_key, key_prefix_of,
    parse_allowed_models, serialize_allowed_models,
};
pub use repository::{APIKeyRepository, EmptyAPIKeyRepository};
pub use routes::create_api_keys_router;
pub use store::{APIKeyStore, EmptyAPIKeyStore};
