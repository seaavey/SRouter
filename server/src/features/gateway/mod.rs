//! Gateway feature: chat, messages, images, fallback, translation, and SSE.

pub mod chat;
pub mod model;
pub mod routes;
pub mod sse;

pub use routes::create_gateway_router;
