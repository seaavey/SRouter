//! Gateway feature: chat, messages, images, fallback, translation, and SSE.

use std::pin::Pin;

use axum::extract::{Extension, OriginalUri, Request};
use axum::http::header;
use futures_util::Stream;

use crate::clock;
use crate::error::APIError;
use crate::features::api_keys::APIPrincipal;
use crate::infrastructure::database::request_logs::generate_log_id;
use crate::request::client_address;

pub mod chat;
pub mod images;
pub mod interception;
pub mod interceptor;
pub mod messages;
pub mod routes;
pub mod search;
pub mod token_saver;
pub mod translation;

pub use images::create_image;
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
    /// Token budget reserved on the API key at admission. `Some` only for chat
    /// requests served with an API key, so the chat completion is the only
    /// place that settles or releases a reservation; messages and anonymous
    /// traffic leave it `None` and never touch the usage columns.
    pub(crate) reserved_tokens: Option<i64>,
}

impl RequestLogContext {
    /// Captures everything a request log row needs from the incoming request.
    pub(crate) fn from_request(
        request: &Request,
        principal: Option<&Extension<APIPrincipal>>,
    ) -> Result<Self, APIError> {
        let start_time = clock::now_ms();
        let request_id = generate_log_id()?;
        let method = request.method().as_str().to_owned();
        let path = request
            .extensions()
            .get::<OriginalUri>()
            .map(|OriginalUri(uri)| uri.path().to_owned())
            .unwrap_or_else(|| request.uri().path().to_owned());
        let client_ip = client_address(request.extensions());
        let user_agent = request
            .headers()
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_owned());
        let api_key_id = principal.and_then(|ext| ext.0.api_key.as_ref().map(|key| key.id.clone()));

        Ok(Self {
            request_id,
            method,
            path,
            client_ip,
            user_agent,
            api_key_id,
            start_time,
            reserved_tokens: None,
        })
    }
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
pub(crate) struct AssembledToolCall {
    id: String,
    name: String,
    arguments: String,
}
