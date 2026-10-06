//! Builds and sends the OpenAI-compatible Cline chat request, including the
//! 401 retry that forces a token refresh.

use std::collections::BTreeMap;

use serde_json::Value;

use super::auth::bearer_token;
use super::executor::ClineExecutor;
use super::types::CLINE_CLIENT_TYPE;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    upstream_error, upstream_status_error, upstream_stream_status_error,
};
use crate::features::providers::rotation::is_rate_limited;
use crate::features::providers::wire::apply_headers;
use crate::infrastructure::database::providers::ClineCredentials;
use crate::protocol::model::ChatCompletionRequest;

pub(super) struct PreparedRequest {
    url: String,
    pub(super) model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

impl ClineExecutor {
    /// One chat attempt per candidate, moving on when upstream answers `429`.
    /// Only the phase before the first byte is covered, so a `429` at status
    /// time fails over while an error mid-stream still surfaces to the client.
    /// The last error is returned when every account is rate limited.
    pub(super) async fn chat_response(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let candidates = self.candidates().await?;
        let mut last: Option<APIError> = None;

        for _ in 0..candidates.len() {
            let credentials = self.pick_account(&candidates).await?;

            match self
                .chat_attempt(model, request, buffered, &credentials)
                .await
            {
                Err(error) if is_rate_limited(&error) => {
                    self.rotator.cool(&credentials.id);
                    last = Some(error);
                }
                outcome => return outcome,
            }
        }

        Err(last.expect("a bounded loop over non-empty candidates ran at least once"))
    }

    /// One attempt against one named connection, including the 401 retry that
    /// forces a token refresh for that same row.
    async fn chat_attempt(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
        credentials: &ClineCredentials,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let prepared = self.prepare(model, request, credentials).await?;
        let response = self.send_chat(&prepared, buffered).await?;

        if response.status().as_u16() != 401 {
            return self.check_chat_status(response, prepared, buffered);
        }

        drop(response);
        let refreshed = self.ensure_fresh_token_for(credentials, true).await?;
        let prepared = self.prepare(model, request, &refreshed).await?;
        let response = self.send_chat(&prepared, buffered).await?;
        self.check_chat_status(response, prepared, buffered)
    }

    fn check_chat_status(
        &self,
        response: reqwest::Response,
        prepared: PreparedRequest,
        streaming: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let status = response.status();
        if status.is_success() {
            return Ok((response, prepared));
        }

        Err(if status.as_u16() == 401 {
            APIError::new(401, constants::providers::cline::TOKEN_EXPIRED)
        } else if status.as_u16() == 402 {
            APIError::new(402, constants::providers::cline::OUT_OF_CREDITS)
        } else if streaming {
            upstream_stream_status_error(status, "Cline chat request failed")
        } else {
            upstream_status_error(status, "Cline chat request failed")
        })
    }

    async fn send_chat(
        &self,
        prepared: &PreparedRequest,
        buffered: bool,
    ) -> Result<reqwest::Response, APIError> {
        let mut request = self
            .client
            .raw()
            .post(&prepared.url)
            .body(prepared.encoded_body.clone());
        if buffered {
            request = request.timeout(self.client.request_timeout());
        }
        request = apply_headers(request, &prepared.headers);
        request.send().await.map_err(upstream_error)
    }

    pub(super) async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        credentials: &ClineCredentials,
    ) -> Result<PreparedRequest, APIError> {
        let model_key = strip_cline_prefix(model.trim()).to_owned();
        let mut body = serde_json::to_value(request).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        body["model"] = Value::String(model_key.clone());
        body["stream"] = Value::Bool(true);
        if model_requires_reasoning(&model_key) {
            strip_reasoning_disables(&mut body);
        }

        let encoded_body = serde_json::to_string(&body).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        let mut headers = BTreeMap::new();
        headers.insert("Authorization", bearer_token(&credentials.access_token));
        headers.insert("Content-Type", "application/json".to_owned());
        headers.insert("Accept-Encoding", "identity".to_owned());
        // The `cline-free/*` models refuse any caller that does not announce
        // a Cline product surface.
        headers.insert("X-CLIENT-TYPE", CLINE_CLIENT_TYPE.to_owned());

        Ok(PreparedRequest {
            url: endpoint_url(&self.endpoints.api_base_url, "chat/completions"),
            model_key,
            encoded_body,
            headers,
        })
    }
}

pub(crate) fn endpoint_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub(super) fn strip_cline_prefix(model: &str) -> &str {
    model.strip_prefix("cline/").unwrap_or(model)
}

/// Whether the upstream endpoint for this model refuses to run without
/// reasoning. Verified live (2026-10-02): `meta/muse-spark-1.3-contributor`
/// answers `400 Reasoning is mandatory for this endpoint and cannot be
/// disabled.` the moment a `reasoning_effort: "none"` reaches it, which
/// fails the whole stream for clients that only want a cheap request.
pub(super) fn model_requires_reasoning(model_key: &str) -> bool {
    model_key.to_ascii_lowercase().contains("muse-spark")
}

/// Drops the reasoning-disable shapes from an outgoing body for models that
/// mandate reasoning. The request struct already drops the unknown
/// `reasoning.enabled` key, so `effort: "none"` (the only disable value
/// upstream accepts as valid input) is what must not be forwarded; leaving
/// the field absent lets upstream run its mandatory reasoning at the default
/// effort instead of rejecting the request.
pub(super) fn strip_reasoning_disables(body: &mut Value) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    if object.get("reasoning_effort").and_then(Value::as_str) == Some("none") {
        object.remove("reasoning_effort");
    }
    if let Some(reasoning) = object.get_mut("reasoning").and_then(Value::as_object_mut)
        && reasoning.get("effort").and_then(Value::as_str) == Some("none")
    {
        reasoning.remove("effort");
    }
}
