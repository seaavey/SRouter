//! Provider adapters. Each adapter maps a typed inference request onto its
//! upstream protocol and returns a typed response or a streamed body.

pub mod opencode_zen;

use std::pin::Pin;

use axum::body::Bytes;
use axum::http::StatusCode;
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::error::APIError;
use crate::features::gateway::model::ChatCompletionRequest;
use crate::features::gateway::sse;
use crate::features::providers::model::ModelDefinition;
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

/// A provider stream of raw SSE bytes. Upstream failures are already encoded
/// as in-stream error events, so the stream itself never yields an error.
pub type ProviderStream = Pin<Box<dyn Stream<Item = Bytes> + Send>>;

/// The adapters the registry can dispatch to. Adding a protocol means adding a
/// variant here and handling it in the delegating methods below.
#[derive(Clone)]
pub enum ProviderAdapter {
    OpenAI(OpenAIAdapter),
}

impl ProviderAdapter {
    /// The provider's registered base id.
    pub fn id(&self) -> &'static str {
        match self {
            Self::OpenAI(adapter) => adapter.id(),
        }
    }

    /// Registry lookup keys: the base id plus any alias.
    pub fn keys(&self) -> &'static [&'static str] {
        match self {
            Self::OpenAI(adapter) => adapter.keys(),
        }
    }

    /// The models this adapter advertises.
    pub fn models(&self) -> &'static [ModelDefinition] {
        match self {
            Self::OpenAI(adapter) => adapter.models(),
        }
    }

    /// Performs a buffered inference request and returns the upstream JSON
    /// body unchanged, the way the Node gateway passes provider responses on.
    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        match self {
            Self::OpenAI(adapter) => adapter.chat_completion(model, request).await,
        }
    }

    /// Performs a streaming inference request. The upstream call happens
    /// inside the returned future so the caller can open the SSE response
    /// first; transport failures are reported as `Err` before any byte flows.
    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        match self {
            Self::OpenAI(adapter) => adapter.chat_completion_stream(model, request).await,
        }
    }
}

/// Adapter for providers that implement the OpenAI chat completions protocol.
#[derive(Clone)]
pub struct OpenAIAdapter {
    id: &'static str,
    keys: &'static [&'static str],
    base_url: String,
    models: &'static [ModelDefinition],
    client: UpstreamClient,
}

impl OpenAIAdapter {
    pub fn new(
        id: &'static str,
        keys: &'static [&'static str],
        base_url: impl Into<String>,
        models: &'static [ModelDefinition],
        client: UpstreamClient,
    ) -> Self {
        Self {
            id,
            keys,
            base_url: base_url.into(),
            models,
            client,
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn models(&self) -> &'static [ModelDefinition] {
        self.models
    }

    /// The upstream chat completions endpoint, normalized to a single slash.
    pub fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        let response = self
            .client
            .raw()
            .post(self.chat_completions_url())
            .timeout(self.client.request_timeout())
            .json(&self.upstream_body(model, request, false)?)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        response.json::<Value>().await.map_err(|error| {
            APIError::new(
                500,
                format!("could not decode the upstream response: {error}"),
            )
        })
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        let response = self
            .client
            .raw()
            .post(self.chat_completions_url())
            .json(&self.upstream_body(model, request, true)?)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_stream_status_error(status, &detail));
        }

        Ok(Self::encode_stream(response.bytes_stream()))
    }

    /// Wraps the upstream byte stream so a stalled connection or a transport
    /// failure ends the response with an in-stream error event instead of
    /// hanging or aborting the connection mid-body.
    fn encode_stream<S>(upstream: S) -> ProviderStream
    where
        S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
    {
        let upstream = Box::pin(upstream);

        let events = futures_util::stream::unfold(Some(upstream), |state| async move {
            let mut upstream = state?;
            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => Some((bytes, Some(upstream))),
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, format!("OpenAI Provider Stream Error: {error}"));
                    Some((sse::error_event_bytes(&failure), None))
                }
                Ok(None) => None,
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        format!(
                            "OpenAI Provider Stream Error: upstream stalled for {}s",
                            STREAM_IDLE_TIMEOUT.as_secs()
                        ),
                    );
                    Some((sse::error_event_bytes(&failure), None))
                }
            }
        });

        Box::pin(events)
    }

    /// Builds the upstream payload: the caller's request with the resolved
    /// bare model id and the adapter's own stream flag. Every other field the
    /// client sent is forwarded untouched.
    fn upstream_body(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        stream: bool,
    ) -> Result<Value, APIError> {
        let mut body = serde_json::to_value(request).map_err(|error| {
            APIError::new(
                500,
                format!("could not build the upstream request: {error}"),
            )
        })?;
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(stream);

        Ok(body)
    }
}

/// Provider failures surface as `500 api_error` with the Node gateway's
/// message shape; the frozen contract maps unhandled errors to `500`.
fn upstream_error(error: reqwest::Error) -> APIError {
    let message = if error.is_timeout() {
        format!("upstream request timed out: {error}")
    } else {
        format!("upstream request failed: {error}")
    };

    APIError::new(500, message)
}

fn upstream_status_error(status: StatusCode, detail: &str) -> APIError {
    APIError::new(
        500,
        format!("OpenAI Provider Error ({}): {detail}", status.as_u16()),
    )
}

fn upstream_stream_status_error(status: StatusCode, detail: &str) -> APIError {
    APIError::new(
        500,
        format!(
            "OpenAI Provider Stream Error ({}): {detail}",
            status.as_u16()
        ),
    )
}
