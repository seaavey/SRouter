//! Antigravity request and header building, the SSRF-guarded remote-image
//! fetcher, the quota retry parser, and the Gemini SSE re-framer.
//!
//! The header set is deliberately minimal (D9): `Content-Type`, the pinned IDE
//! user agent, and the auth header selected by the token prefix (D7). A
//! `ya29.` Google access token uses `Authorization: Bearer` plus
//! `x-goog-api-client`; an `AIzaSy` key switches to `x-goog-api-key`. The chat
//! endpoint is the static `daily-cloudcode-pa` host; a per-connection
//! `base_url` is not honored.

use std::collections::{BTreeMap, VecDeque};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::pin::Pin;
use std::time::Duration;

use axum::body::Bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::{Stream, StreamExt};
use serde_json::{Value, json};

use super::executor::AntigravityExecutor;
use super::translate::{self, EnvelopeArgs, GeminiStreamState, InlineImage};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderStream, upstream_error};
use crate::features::providers::wire::{apply_headers, bearer_token};
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::infrastructure::upstream::ssrf;
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse;

/// The official Antigravity IDE desktop fingerprint (macOS arm64), pinned so
/// the upstream sees the same client the Node oracle sends.
const IDE_USER_AGENT: &str = "antigravity/ide/2.1.1 darwin/arm64";
/// The `x-goog-api-client` value the IDE sends alongside a `ya29.` token.
const GOOG_API_CLIENT: &str = "gl-node/18.0.0 gd/1.0.0";
/// Bound on a remote image fetch, mirroring the oracle's 10s abort.
const IMAGE_FETCH_TIMEOUT: Duration = Duration::from_secs(10);
/// Largest remote image body the fetcher will buffer. The URL is caller
/// supplied, so an unbounded read would let one key pressure gateway memory.
pub(super) const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;

pub(super) struct PreparedRequest {
    url: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

impl AntigravityExecutor {
    /// The minimal header set (D9) with the auth header chosen by the token
    /// prefix (D7).
    pub(super) fn request_headers(&self, token: &str) -> BTreeMap<&'static str, String> {
        let mut headers = BTreeMap::new();
        headers.insert("Content-Type", "application/json".to_owned());
        headers.insert("User-Agent", IDE_USER_AGENT.to_owned());

        if token.starts_with("AIzaSy") {
            headers.insert("x-goog-api-key", token.to_owned());
        } else {
            headers.insert("Authorization", bearer_token(token));
            if token.starts_with("ya29.") {
                headers.insert("x-goog-api-client", GOOG_API_CLIENT.to_owned());
            }
        }

        headers
    }

    /// Builds the IDE envelope: `contents`, `generationConfig`, tools when the
    /// caller supplied any, wrapped in the `{project, model, ...}` shell.
    async fn prepare(
        &self,
        wire_model: &str,
        request: &ChatCompletionRequest,
        project_id: &str,
        access_token: &str,
        credit_types: Option<&[String]>,
    ) -> Result<PreparedRequest, APIError> {
        let contents =
            translate::build_contents_async(request, |url| self.fetch_remote_image(url)).await;

        let mut body = json!({
            "contents": contents,
            "generationConfig": translate::build_generation_config(request, wire_model),
        });
        let tools = translate::build_tools(request);
        if !tools.is_empty() {
            body["tools"] = json!(tools);
            body["toolConfig"] = translate::tool_config();
        }
        translate::strip_blacklisted_request(&mut body);

        let envelope = translate::build_envelope(EnvelopeArgs {
            project_id,
            model: wire_model,
            request_type: "agent",
            request: body,
            existing_request_id: None,
            session_id: None,
            enabled_credit_types: credit_types,
            now_ms: now_ms(),
        });
        let encoded_body = serde_json::to_string(&envelope).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;

        Ok(PreparedRequest {
            url: self.endpoints.chat_url.clone(),
            encoded_body,
            headers: self.request_headers(access_token),
        })
    }

    /// Sends one cascade candidate, retrying once with the `GOOGLE_ONE_AI`
    /// credit type when the first answer is a quota error (429 /
    /// `RESOURCE_EXHAUSTED`).
    pub(super) async fn send_candidate(
        &self,
        wire_model: &str,
        request: &ChatCompletionRequest,
        project_id: &str,
        access_token: &str,
    ) -> Result<reqwest::Response, APIError> {
        match self
            .send_once(wire_model, request, project_id, access_token, None)
            .await
        {
            Ok(response) => Ok(response),
            Err(error) if credit_retry_is_due(&error) => {
                let credits = ["GOOGLE_ONE_AI".to_owned()];
                self.send_once(
                    wire_model,
                    request,
                    project_id,
                    access_token,
                    Some(&credits),
                )
                .await
            }
            Err(error) => Err(error),
        }
    }

    async fn send_once(
        &self,
        wire_model: &str,
        request: &ChatCompletionRequest,
        project_id: &str,
        access_token: &str,
        credit_types: Option<&[String]>,
    ) -> Result<reqwest::Response, APIError> {
        let prepared = self
            .prepare(wire_model, request, project_id, access_token, credit_types)
            .await?;
        let response = apply_headers(
            self.client
                .raw()
                .post(&prepared.url)
                .body(prepared.encoded_body.clone()),
            &prepared.headers,
        )
        .send()
        .await
        .map_err(upstream_error)?;

        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }

        let detail = response.text().await.unwrap_or_default();
        Err(provider_error(status.as_u16(), &detail))
    }

    /// Fetches a remote image through the SSRF guard as `(mimeType, base64)`. A
    /// blocked host, a failed fetch, a redirect, a non-image answer, or a body
    /// over [`IMAGE_MAX_BYTES`] drops the image, exactly as the oracle's async
    /// builder does.
    ///
    /// The fetch uses a redirect-disabled client so the host check on the
    /// initial URL is the only hop; a `3xx` to an internal target is a
    /// non-success drop, not a followed request.
    ///
    /// The host is resolved here, once, and the client is pinned to the
    /// validated addresses, so reqwest cannot re-resolve to a different
    /// (rebinding) target after the check.
    async fn fetch_remote_image(&self, url: String) -> Option<InlineImage> {
        let parsed = url::Url::parse(&url).ok()?;
        let port = parsed.port_or_known_default()?;
        let (domain, addresses) = resolve_image_target(parsed.host()?, port)?;

        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(IMAGE_FETCH_TIMEOUT);
        if let Some(domain) = domain {
            builder = builder.resolve_to_addrs(&domain, &addresses);
        }
        let client = builder.build().ok()?;

        let mut response = client
            .get(parsed)
            .timeout(IMAGE_FETCH_TIMEOUT)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }

        let mime_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or("").trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("image/png")
            .to_owned();

        // Reject an over-large declared body before reading it, then keep the
        // accumulated bytes under the same cap so a chunked or absent
        // `Content-Length` cannot slip past.
        if response
            .content_length()
            .is_some_and(|length| image_cap_exceeded(length, 0))
        {
            return None;
        }
        let mut bytes = Vec::new();
        loop {
            let Some(chunk) = response.chunk().await.ok()? else {
                break;
            };
            if image_cap_exceeded(bytes.len() as u64, chunk.len()) {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }

        Some((mime_type, STANDARD.encode(&bytes)))
    }
}

/// Resolves and validates the host of a remote image URL exactly once. Returns
/// the domain to pin (absent for a literal IP, which needs no resolution) and
/// the addresses it resolved to, or `None` when any address is blocked or the
/// host cannot be resolved. Fails closed: a resolution failure drops the image
/// rather than fetching an unvalidated address.
///
/// The address predicate is the shared [`ssrf::is_blocked_address`]; this
/// wrapper is local to the image path so the shared helper's behavior stays
/// unchanged for its other consumers.
pub(super) fn resolve_image_target(
    host: url::Host<&str>,
    port: u16,
) -> Option<(Option<String>, Vec<SocketAddr>)> {
    let allow = |address: IpAddr| !ssrf::is_blocked_address(address);

    match host {
        url::Host::Domain(domain) => {
            let addresses: Vec<SocketAddr> = (domain, port).to_socket_addrs().ok()?.collect();
            if addresses.is_empty() || addresses.iter().any(|address| !allow(address.ip())) {
                return None;
            }
            Some((Some(domain.to_owned()), addresses))
        }
        url::Host::Ipv4(address) => {
            let address = SocketAddr::new(IpAddr::V4(address), port);
            allow(address.ip()).then(|| (None, vec![address]))
        }
        url::Host::Ipv6(address) => {
            let address = SocketAddr::new(IpAddr::V6(address), port);
            allow(address.ip()).then(|| (None, vec![address]))
        }
    }
}

/// Whether a body of `accumulated` bytes plus a `chunk` of the given size would
/// exceed [`IMAGE_MAX_BYTES`]. Saturating so a hostile length cannot wrap.
pub(super) fn image_cap_exceeded(accumulated: u64, chunk: usize) -> bool {
    accumulated.saturating_add(chunk as u64) > IMAGE_MAX_BYTES
}

/// Builds the typed provider error, with the `Retry-After` hint the oracle
/// appends when the body names a reset window.
pub(super) fn provider_error(status: u16, detail: &str) -> APIError {
    let retry_after_secs =
        parse_retry_from_error_message(detail).map(|millis| ((millis + 999) / 1000) as u64);

    APIError::new(
        500,
        constants::providers::antigravity::provider_error(status, detail, retry_after_secs),
    )
}

/// The oracle's `parseRetryFromErrorMessage`: reads a `resets after 2h30m10s`
/// window out of a quota message. A match with no units is the oracle's 2s.
pub(super) fn parse_retry_from_error_message(message: &str) -> Option<i64> {
    let lower = message.to_ascii_lowercase();
    let mut search_from = 0;

    while let Some(relative) = lower[search_from..].find("reset") {
        let after_reset = search_from + relative + "reset".len();
        let rest = lower[after_reset..]
            .strip_prefix('s')
            .unwrap_or(&lower[after_reset..]);
        let rest = rest.trim_start();
        if let Some(rest) = rest
            .strip_prefix("after")
            .or_else(|| rest.strip_prefix("in"))
        {
            return Some(parse_duration_suffix(rest.trim_start()));
        }
        search_from = after_reset;
    }

    None
}

/// Parses the oracle's optional `(\d+h)?(\d+m)?(\d+s)?` suffix into
/// milliseconds. A suffix without any unit is the oracle's 2s fallback.
fn parse_duration_suffix(suffix: &str) -> i64 {
    let mut total = 0i64;
    let mut remainder = suffix;

    for (unit, multiplier) in [('h', 3_600_000i64), ('m', 60_000), ('s', 1000)] {
        let digits_end = remainder
            .find(|character: char| !character.is_ascii_digit())
            .unwrap_or(remainder.len());
        if digits_end == 0 {
            continue;
        }
        if let Some(after_unit) = remainder[digits_end..].strip_prefix(unit) {
            let value: i64 = remainder[..digits_end].parse().unwrap_or(0);
            total = total.saturating_add(value.saturating_mul(multiplier));
            remainder = after_unit;
        }
    }

    if total == 0 { 2000 } else { total }
}

/// Whether a failed candidate is a quota error worth one `GOOGLE_ONE_AI` retry.
pub(super) fn credit_retry_is_due(error: &APIError) -> bool {
    let message = error.message();

    message.contains("(429)")
        || message.contains("RESOURCE_EXHAUSTED")
        || message.contains("quota_exhausted")
        || message.contains("reset after")
        || message.contains("Resets in")
}

/// Re-frames the upstream Gemini SSE body as OpenAI chunk frames, ending the
/// response with exactly one `data: [DONE]`.
pub(super) fn stream_response<S>(upstream: S, model: String) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = (
        Pin<Box<S>>,
        String,
        GeminiStreamState,
        VecDeque<Bytes>,
        bool,
    );

    let state: State<S> = (
        Box::pin(upstream),
        String::new(),
        GeminiStreamState::new(&model),
        VecDeque::new(),
        false,
    );

    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut buffer, mut gemini_state, mut pending, mut done) = state;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, (upstream, buffer, gemini_state, pending, done)));
            }
            if done {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    translate_frames(&mut buffer, &mut gemini_state, &mut pending);
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
                Ok(None) => {
                    // Terminate any final line the upstream left unterminated.
                    buffer.push('\n');
                    translate_frames(&mut buffer, &mut gemini_state, &mut pending);
                    pending.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
                    done = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
            }
        }
    });

    Box::pin(events)
}

/// Drains every complete `data:` line from the buffer and appends the OpenAI
/// frames each Gemini frame translates to.
fn translate_frames(
    buffer: &mut String,
    state: &mut GeminiStreamState,
    pending: &mut VecDeque<Bytes>,
) {
    while let Some(position) = buffer.find('\n') {
        let line = buffer[..position].trim().to_owned();
        buffer.drain(..=position);

        let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(&line);
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        let Ok(frame) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        if let Some(chunks) = translate::gemini_stream_to_openai_chunks(&frame, state, now_ms()) {
            for chunk in chunks {
                pending.push_back(Bytes::from(format!("data: {chunk}\n\n")));
            }
        }
    }
}
