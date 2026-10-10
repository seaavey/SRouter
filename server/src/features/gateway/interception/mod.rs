//! Shared gateway plumbing for the OpenAI chat and Anthropic messages routes.
//!
//! Both routes read and classify the request body, log their request rows, and
//! drive the same server-side tool-interception machine: a buffered path
//! (`run_buffered_interception`) and a streaming path whose SSE deltas are
//! accumulated by [`StreamTurn`]. The route handlers supply only their own wire
//! shape (error envelope, response rendering).
//!
//! Split into `body` (reading and classifying), `logging` (request rows plus
//! API-key quota), `turn` (the streaming machine), and `buffered` (the
//! non-streaming path); the public path stays `gateway::interception::*`.

mod body;
mod buffered;
mod logging;
mod turn;

pub(crate) use body::{BodyError, body_error_to_api_error, read_json_body};
pub(crate) use buffered::run_buffered_interception;
pub(crate) use logging::{
    log_request, log_stream_success, stream_log_status, unresolved_provider_id,
};
pub(crate) use turn::{
    MAX_INTERCEPT_DEPTH, StreamTurn, observe_usage, stream_error_payload, try_intercept,
};
