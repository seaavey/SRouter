//! Gateway feature: chat, messages, images, fallback, translation, and SSE.

pub mod anthropic;
pub mod chat;
pub mod interceptor;
pub mod messages;
pub mod model;
pub mod models;
pub mod routes;
pub mod search;
pub mod sse;
pub mod usage;

pub use routes::create_gateway_router;
