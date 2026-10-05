//! Grok Web provider: the undocumented grok.com WebSocket chat transport.
//!
//! Provenance for every protocol detail (independent of `packages/*`): live
//! probes against grok.com on 2026-10-01 with a real SSO session. The REST
//! endpoint `POST /rest/app-chat/conversations/new` rejects every request
//! without the browser `botoxSign` signature, so this provider speaks the
//! WebSocket the real web client uses: `wss://grok.com/ws/mgw/?uid=<x-userid>`
//! carrying `session.create` → `response.create` → `response.chunk` frames.
//!
//! Protocol fragility: all of this is private and may change without notice.
//! Every transport decision is documented at the code site that makes it.

pub mod executor;
pub mod types;

mod auth;
mod request;
mod translate;
mod transport;

#[cfg(test)]
mod tests;

pub use executor::{GrokWebExecutor, adapter, adapter_with_endpoints};
pub use types::{GROK_WEB_KEYS, GROK_WEB_PROVIDER, GrokWebEndpoints};
