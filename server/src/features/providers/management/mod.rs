//! Provider management: the `/v1/providers` catalog, detail, and toggles the
//! Providers page reads and writes.

pub mod custom_routes;
pub mod model;
pub mod routes;

pub use custom_routes::create_custom_provider_router;
pub use routes::{create_providers_management_router, create_providers_read_router};
