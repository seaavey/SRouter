//! Gateway feature: chat, messages, images, fallback, translation, and SSE.

use std::pin::Pin;

use futures_util::Stream;

pub mod anthropic;
pub mod chat;
pub mod interceptor;
pub mod messages;
pub mod model;
pub mod models;
pub mod routes;
pub mod search;
pub mod sse;
pub mod token_saver;
pub mod usage;

pub use routes::create_gateway_router;

#[derive(Clone)]
pub(crate) struct RequestLogContext {
    pub request_id: String,
    pub method: String,
    pub path: String,
    pub client_ip: Option<String>,
    pub user_agent: Option<String>,
    pub api_key_id: Option<String>,
    pub start_time: i64,
}

/// An mpsc receiver of stream events, presented as a `Stream` for the response body.
struct ReceiverStream<T>(tokio::sync::mpsc::Receiver<T>);

impl<T> Stream for ReceiverStream<T> {
    type Item = T;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.0.poll_recv(cx)
    }
}

/// A tool call accumulated across streamed deltas.
#[derive(Clone, Debug, Default)]
struct AssembledToolCall {
    id: String,
    name: String,
    arguments: String,
}
