//! OpenAI ⇄ Anthropic protocol translation (the migration plan's Task 9: this
//! module owns the contract translation).
//!
//! Split by responsibility: [`types`] holds the Anthropic Messages wire types
//! and ids, [`error`] the error/envelope helpers, [`request`]/[`response`] the
//! pure converters onto the internal OpenAI-compatible types, [`validate`] the
//! observable schema rules, [`stream`] the SSE translator, and [`tokens`] the
//! token estimate. Validation wording and every mapping rule are frozen against
//! `apps/api` (`MessagesController` + `@srouter/translator`), probed black-box
//! because the Node schema lives in `packages/*` and cannot be read.
//!
//! Recorded deviation: an upstream tool call without a `name` translates to
//! `name: ""` and the request still succeeds; Node crashes with a `500` on the
//! same payload, and reproducing a crash is not a contract.

mod error;
mod request;
mod response;
mod stream;
mod tokens;
mod types;
mod validate;

pub use error::{
    AnthropicErrorBody, AnthropicErrorEnvelope, anthropic_error, anthropic_error_event_bytes,
    anthropic_error_type, anthropic_error_typed,
};
pub use request::anthropic_to_openai_request;
pub use response::openai_to_anthropic_response;
pub use stream::AnthropicStreamTranslator;
pub use tokens::estimate_tokens;
pub use types::{
    AnthropicContentBlock, AnthropicMessage, AnthropicMessageContent, AnthropicMessageRequest,
    AnthropicSystem, AnthropicSystemBlock, AnthropicThinking, AnthropicTool, AnthropicToolChoice,
    ImageSource, generate_id,
};
pub use validate::validate_anthropic_request;

#[cfg(test)]
mod tests;
