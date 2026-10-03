//! Provider adapters and base executors. Each adapter maps a typed inference
//! request onto its upstream protocol and returns a typed response or a streamed body.

use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use axum::http::StatusCode;
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::ChatCompletionRequest;
use crate::features::gateway::sse;
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::model::ModelDefinition;
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

/// A provider stream of raw SSE bytes. Upstream failures are already encoded
/// as in-stream error events, so the stream itself never yields an error.
pub type ProviderStream = Pin<Box<dyn Stream<Item = Bytes> + Send>>;

/// A registered provider driver. This is a thin handle over the driver's trait
/// object so the registry and the gateway can clone it cheaply; all dispatch
/// goes through [`ProviderExecutor`], which each driver module implements.
#[derive(Clone)]
pub struct ProviderAdapter(Arc<dyn ProviderExecutor>);

impl ProviderAdapter {
    /// Wraps a driver implementation.
    pub fn new(executor: impl ProviderExecutor + 'static) -> Self {
        Self(Arc::new(executor))
    }

    /// Borrows the driver as a concrete `T`, for the endpoint accessors in
    /// [`crate::features::providers::registry`]. Returns `None` when the
    /// adapter is a different driver.
    pub fn downcast_ref<T: ProviderExecutor + 'static>(&self) -> Option<&T> {
        self.0.as_any().downcast_ref::<T>()
    }

    /// The provider's registered base id.
    pub fn id(&self) -> &'static str {
        self.0.id()
    }

    /// Registry lookup keys: the base id plus any alias.
    pub fn keys(&self) -> &'static [&'static str] {
        self.0.keys()
    }

    /// The user-facing model prefix, mirroring Node's `providerAliasFor`.
    pub fn alias(&self) -> &'static str {
        self.0.alias()
    }

    /// The model ids this driver advertises.
    pub fn models(&self) -> Vec<String> {
        self.0.models()
    }

    /// Every bare id this driver advertises for the model `model` names.
    pub fn model_id_variants(&self, model: &str) -> Vec<String> {
        self.0.model_id_variants(model)
    }

    /// Asks the driver to refresh a time-varying catalog. A driver with a fixed
    /// list does nothing.
    pub async fn maybe_refresh(&self, force: bool) {
        self.0.maybe_refresh(force).await
    }

    /// Performs a buffered inference request and returns the upstream JSON body
    /// unchanged, the way the Node gateway passes provider responses on.
    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.0.chat_completion(model, request).await
    }

    /// Performs a streaming inference request. The upstream call happens inside
    /// the returned future so the caller can open the SSE response first;
    /// transport failures are reported as `Err` before any byte flows.
    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.0.chat_completion_stream(model, request).await
    }
}

/// Adapter/Executor for providers that implement the OpenAI chat completions protocol.
#[derive(Clone)]
pub struct OpenAIAdapter {
    id: &'static str,
    keys: &'static [&'static str],
    base_url: String,
    models: &'static [ModelDefinition],
    client: UpstreamClient,
}

pub type OpenAIExecutor = OpenAIAdapter;

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

    pub fn alias(&self) -> &'static str {
        self.id
    }

    pub fn models(&self) -> Vec<String> {
        self.models
            .iter()
            .map(|model| model.id.to_owned())
            .collect()
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
            APIError::new(500, constants::providers::could_not_decode_response(&error))
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

        Ok(encode_stream(response.bytes_stream()))
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
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(stream);

        Ok(body)
    }
}

impl ProviderExecutor for OpenAIAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        OpenAIAdapter::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        OpenAIAdapter::keys(self)
    }

    fn alias(&self) -> &'static str {
        OpenAIAdapter::alias(self)
    }

    fn models(&self) -> Vec<String> {
        OpenAIAdapter::models(self)
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { OpenAIAdapter::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { OpenAIAdapter::chat_completion_stream(self, model, request).await })
    }
}

/// Wraps the upstream byte stream so a stalled connection or a transport
/// failure ends the response with an in-stream error event instead of
/// hanging or aborting the connection mid-body.
pub(crate) fn encode_stream<S>(upstream: S) -> ProviderStream
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
                    APIError::new(500, constants::providers::upstream_stream_failed(&error));
                Some((sse::error_event_bytes(&failure), None))
            }
            Ok(None) => None,
            Err(_) => {
                let failure = APIError::new(
                    500,
                    constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                );
                Some((sse::error_event_bytes(&failure), None))
            }
        }
    });

    Box::pin(events)
}

/// Provider failures surface as `500 api_error` with the Node gateway's
/// message shape; the frozen contract maps unhandled errors to `500`.
pub(crate) fn upstream_error(error: reqwest::Error) -> APIError {
    let message = if error.is_timeout() {
        constants::providers::request_timed_out(&error)
    } else {
        constants::providers::request_failed(&error)
    };

    APIError::new(500, message)
}

pub(crate) fn upstream_status_error(status: StatusCode, detail: &str) -> APIError {
    APIError::new(
        500,
        constants::providers::upstream_error(status.as_u16(), detail),
    )
}

pub(crate) fn upstream_stream_status_error(status: StatusCode, detail: &str) -> APIError {
    APIError::new(
        500,
        constants::providers::upstream_stream_error(status.as_u16(), detail),
    )
}
