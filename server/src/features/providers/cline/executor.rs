//! Cline executor: credential refresh, live catalog, and chat transport.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::header::{HeaderName, HeaderValue};
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::{ChatCompletionRequest, ChatContent, ChatMessage};
use crate::features::gateway::sse;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::cline::catalog::{
    ClineCatalog, SharedCatalog, read_catalog, write_catalog,
};
use crate::features::providers::cline::types::{
    CLINE_CLIENT_TYPE, CLINE_KEYS, CLINE_PROVIDER, ClineEndpoints,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    ClineCredentials, load_cline_credentials, update_cline_tokens,
};
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

pub const CATALOG_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;
const TOKEN_REFRESH_FALLBACK_MS: i64 = 12 * 60 * 60 * 1000;

struct PreparedRequest {
    url: String,
    model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

/// Cline's live catalog and credential-backed OpenAI-compatible transport.
#[derive(Clone)]
pub struct ClineExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    endpoints: ClineEndpoints,
    database: Option<AppDatabase>,
    client: UpstreamClient,
    pub catalog: SharedCatalog,
    catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    token_refreshes: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl ClineExecutor {
    pub fn new(
        endpoints: ClineEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            id: CLINE_PROVIDER.id,
            keys: CLINE_KEYS,
            endpoints,
            database,
            client,
            catalog: ClineCatalog::shared_empty(),
            catalog_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            token_refreshes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &'static str {
        CLINE_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub fn model_id_variants(&self, model: &str) -> Vec<String> {
        vec![strip_cline_prefix(model.trim()).to_lowercase()]
    }

    pub fn endpoints(&self) -> &ClineEndpoints {
        &self.endpoints
    }

    /// An empty catalog waits for the shared fetch; a populated one refreshes in the background.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        if !matches!(load_cline_credentials(database).await, Ok(Some(_))) {
            return;
        }

        if read_catalog(&self.catalog).is_empty() {
            let _ = self.refresh_catalog_coalesced(force).await;
            return;
        }

        if !self.refresh_is_due(force) {
            return;
        }

        let executor = self.clone();
        tokio::spawn(async move {
            let _ = executor.refresh_catalog_coalesced(force).await;
        });
    }

    fn refresh_is_due(&self, force: bool) -> bool {
        read_catalog(&self.catalog).refresh_is_due(force, now_ms())
    }

    async fn refresh_catalog_coalesced(&self, force: bool) -> Result<(), APIError> {
        let _guard = self.catalog_refresh_lock.lock().await;
        if !self.refresh_is_due(force) {
            return Ok(());
        }

        write_catalog(&self.catalog).attempted_at_ms = now_ms();
        self.refresh_catalog().await
    }

    /// Replaces the snapshot only when upstream returns a usable model list.
    pub async fn refresh_catalog(&self) -> Result<(), APIError> {
        let credentials = self.ensure_fresh_token(false).await?;
        let response = self
            .client
            .raw()
            .get(endpoint_url(&self.endpoints.api_base_url, "models"))
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("Authorization", bearer_token(&credentials.access_token))
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(upstream_error)?;
        let status = response.status();

        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(map_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;
        if let Some(mut catalog) = ClineCatalog::parse_model_list(&payload) {
            // The curated list carries the `cline-free/*` ids `/models` omits,
            // so the two are merged before the snapshot is replaced. A failed
            // curated fetch keeps the catalog usable without them.
            let curated = self.free_models(&credentials.access_token).await;
            if !curated.is_empty() {
                catalog.models.extend(curated);
                catalog.models.sort();
                catalog.models.dedup();
            }
            *write_catalog(&self.catalog) = catalog;
        }

        Ok(())
    }

    /// The `cline-free/*` ids of the curated recommended-models payload. This
    /// list is optional: any failure adds nothing instead of failing the
    /// refresh, which is what the official client does as well.
    async fn free_models(&self, access_token: &str) -> Vec<String> {
        let Ok(response) = self
            .client
            .raw()
            .get(endpoint_url(
                &self.endpoints.api_base_url,
                "ai/cline/recommended-models",
            ))
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("Authorization", bearer_token(access_token))
            .header("Accept", "application/json")
            .send()
            .await
        else {
            return Vec::new();
        };
        if !response.status().is_success() {
            return Vec::new();
        }

        let payload = response.json::<Value>().await.unwrap_or(Value::Null);
        ClineCatalog::parse_free_list(&payload)
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.maybe_refresh(false).await;
        let (response, prepared) = self.chat_response(model, request, true).await?;
        let mut upstream = response.bytes_stream();
        let mut decoder = EventDecoder::default();
        let mut aggregator = Aggregator::new(&prepared.model_key);

        while let Some(item) = upstream.next().await {
            let bytes = item.map_err(upstream_error)?;
            for frame in decoder.push(&bytes) {
                aggregator.accept(frame)?;
            }
        }
        for frame in decoder.finish() {
            aggregator.accept(frame)?;
        }

        aggregator.finish(request)
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.maybe_refresh(false).await;
        let (response, _) = self.chat_response(model, request, false).await?;
        Ok(translate_stream(response.bytes_stream()))
    }

    async fn chat_response(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let prepared = self.prepare(model, request, false).await?;
        let response = self.send_chat(&prepared, buffered).await?;

        if response.status().as_u16() != 401 {
            self.check_chat_status(response, prepared, buffered)
        } else {
            drop(response);
            self.ensure_fresh_token(true).await?;
            let prepared = self.prepare(model, request, false).await?;
            let response = self.send_chat(&prepared, buffered).await?;
            self.check_chat_status(response, prepared, buffered)
        }
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

    async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        force_refresh: bool,
    ) -> Result<PreparedRequest, APIError> {
        let credentials = self.ensure_fresh_token(force_refresh).await?;
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

    async fn credentials(&self) -> Result<ClineCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::cline::DATABASE_REQUIRED))?;

        load_cline_credentials(database)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| APIError::new(401, constants::providers::cline::NOT_CONNECTED))
    }

    async fn ensure_fresh_token(&self, force: bool) -> Result<ClineCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.as_deref() else {
            if credentials.is_expired(now_ms()) || force {
                return Err(APIError::new(
                    401,
                    constants::providers::cline::TOKEN_EXPIRED,
                ));
            }
            return Ok(credentials);
        };

        let refresh_lock = {
            let mut refreshes = self
                .token_refreshes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            refreshes
                .entry(credentials.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = refresh_lock.lock().await;

        let current = self.credentials().await?;
        if !force && !token_refresh_is_due(&current, now_ms()) {
            return Ok(current);
        }
        let refresh_token = current.refresh_token.as_deref().unwrap_or(refresh_token);

        match self.refresh_token(&current.id, refresh_token).await {
            Ok(refreshed) => Ok(refreshed),
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        connection_id: &str,
        refresh_token: &str,
    ) -> Result<ClineCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::cline::DATABASE_REQUIRED))?;
        let response = self
            .client
            .raw()
            .post(endpoint_url(&self.endpoints.api_base_url, "auth/refresh"))
            .timeout(self.client.request_timeout())
            .json(&serde_json::json!({
                "refreshToken": strip_workos_prefix(refresh_token),
                "grantType": "refresh_token",
            }))
            .send()
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::providers::cline::refresh_transport_failed(error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);

        if status.is_client_error() || payload_reports_invalid_grant(&payload) {
            return Err(APIError::new(
                401,
                constants::providers::cline::TOKEN_EXPIRED,
            ));
        }
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::cline::refresh_failed(status.as_u16()),
            ));
        }

        let payload = unwrap_success(payload)?;
        let access_token = payload
            .get("accessToken")
            .or_else(|| payload.get("access_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| APIError::new(401, constants::providers::cline::TOKEN_EXPIRED))?;
        let rotated_refresh = payload
            .get("refreshToken")
            .or_else(|| payload.get("refresh_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .unwrap_or(strip_workos_prefix(refresh_token));
        let expires_at = payload
            .get("expiresAt")
            .or_else(|| payload.get("expires_at"))
            .and_then(parse_expiry_ms);
        let refreshed_at = now_ms();
        let access_token = prefixed_token(access_token);

        update_cline_tokens(
            database,
            connection_id,
            &access_token,
            rotated_refresh,
            expires_at,
            refreshed_at,
        )
        .await?;

        Ok(ClineCredentials {
            id: connection_id.to_owned(),
            access_token,
            refresh_token: Some(rotated_refresh.to_owned()),
            token_expires_at: expires_at,
            last_refreshed_at: Some(refreshed_at),
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

fn strip_cline_prefix(model: &str) -> &str {
    model.strip_prefix("cline/").unwrap_or(model)
}

/// Whether the upstream endpoint for this model refuses to run without
/// reasoning. Verified live (2026-10-02): `meta/muse-spark-1.3-contributor`
/// answers `400 Reasoning is mandatory for this endpoint and cannot be
/// disabled.` the moment a `reasoning_effort: "none"` reaches it, which
/// fails the whole stream for clients that only want a cheap request.
fn model_requires_reasoning(model_key: &str) -> bool {
    model_key.to_ascii_lowercase().contains("muse-spark")
}

/// Drops the reasoning-disable shapes from an outgoing body for models that
/// mandate reasoning. The request struct already drops the unknown
/// `reasoning.enabled` key, so `effort: "none"` (the only disable value
/// upstream accepts as valid input) is what must not be forwarded; leaving
/// the field absent lets upstream run its mandatory reasoning at the default
/// effort instead of rejecting the request.
fn strip_reasoning_disables(body: &mut Value) {
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

fn prefixed_token(token: &str) -> String {
    if token.starts_with("workos:") {
        token.to_owned()
    } else {
        format!("workos:{token}")
    }
}

fn bearer_token(token: &str) -> String {
    format!("Bearer {}", prefixed_token(token))
}

/// The `workos:` prefix is a header-only marker; upstream answers
/// `400 failed to refresh token` for a prefixed refresh token.
fn strip_workos_prefix(token: &str) -> &str {
    token.strip_prefix("workos:").unwrap_or(token)
}

fn apply_headers(
    request: reqwest::RequestBuilder,
    headers: &BTreeMap<&'static str, String>,
) -> reqwest::RequestBuilder {
    headers.iter().fold(request, |request, (name, value)| {
        match (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            (Ok(name), Ok(value)) => request.header(name, value),
            _ => request,
        }
    })
}

fn token_refresh_is_due(credentials: &ClineCredentials, now: i64) -> bool {
    match credentials.token_expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => credentials
            .last_refreshed_at
            .is_none_or(|refreshed_at| now - refreshed_at >= TOKEN_REFRESH_FALLBACK_MS),
    }
}

fn payload_reports_invalid_grant(payload: &Value) -> bool {
    error_message(payload).is_some_and(|message| message.to_lowercase().contains("invalid_grant"))
}

fn unwrap_success(payload: Value) -> Result<Value, APIError> {
    match payload.get("success").and_then(Value::as_bool) {
        Some(false) => Err(APIError::new(
            500,
            error_message(&payload).unwrap_or_else(|| "Cline request failed".to_owned()),
        )),
        Some(true) => Ok(payload.get("data").cloned().unwrap_or(Value::Null)),
        None => Ok(payload),
    }
}

fn error_message(payload: &Value) -> Option<String> {
    let error = payload.get("error")?;
    if let Some(message) = error.as_str() {
        return Some(message.to_owned());
    }

    error
        .get("message")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn map_status_error(status: reqwest::StatusCode, detail: &str) -> APIError {
    match status.as_u16() {
        401 => APIError::new(401, constants::providers::cline::TOKEN_EXPIRED),
        402 => APIError::new(402, constants::providers::cline::OUT_OF_CREDITS),
        _ => upstream_status_error(status, detail),
    }
}

pub(crate) fn parse_expiry_ms(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number < 10_000_000_000 {
            number.saturating_mul(1000)
        } else {
            number
        });
    }

    let text = value.as_str()?.trim();
    if let Ok(number) = text.parse::<i64>() {
        return Some(if number < 10_000_000_000 {
            number.saturating_mul(1000)
        } else {
            number
        });
    }

    parse_rfc3339_ms(text)
}

/// Parses the UTC timestamp upstream ships, `2026-12-31T00:00:00Z`. Any other
/// shape yields `None`, which leaves the expiry unknown and lets the caller
/// fall back to its refresh window instead of guessing.
fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    let (date, time) = value.split_once('T')?;
    let time = time.strip_suffix('Z')?;
    let mut date = date.split('-').map(|part| part.parse::<i64>().ok());
    let year = date.next()??;
    let month = date.next()??;
    let day = date.next()??;
    if date.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let mut clock = time.split(':');
    let hour = clock.next()?.parse::<i64>().ok()?;
    let minute = clock.next()?.parse::<i64>().ok()?;
    let second_part = clock.next()?;
    if clock.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    let (second, millis) = match second_part.split_once('.') {
        Some((second, fraction)) => {
            let fraction = fraction.chars().take(3).collect::<String>();
            let millis = format!("{fraction:0<3}").parse::<i64>().ok()?;
            (second.parse::<i64>().ok()?, millis)
        }
        None => (second_part.parse::<i64>().ok()?, 0),
    };
    if second > 60 {
        return None;
    }

    let days = days_from_civil(year, month, day);
    Some(
        (days * 86_400 + hour * 3600 + minute * 60 + second)
            .saturating_mul(1000)
            .saturating_add(millis),
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[derive(Debug)]
enum DecodedFrame {
    Data(Value),
    Raw(String),
    Done,
    Error(APIError),
}

#[derive(Default)]
struct EventDecoder {
    buffer: String,
    event_lines: Vec<String>,
    finished: bool,
}

impl EventDecoder {
    fn push(&mut self, bytes: &[u8]) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut frames = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=position);
            if line.is_empty() {
                if let Some(frame) = self.take_event() {
                    frames.push(frame);
                }
            } else {
                self.event_lines.push(line);
            }
        }

        frames
    }

    fn finish(&mut self) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        if !self.buffer.is_empty() {
            self.event_lines.push(
                std::mem::take(&mut self.buffer)
                    .trim_end_matches('\r')
                    .to_owned(),
            );
        }

        self.take_event().into_iter().collect()
    }

    fn take_event(&mut self) -> Option<DecodedFrame> {
        let lines = std::mem::take(&mut self.event_lines);
        let payload = lines
            .iter()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        if payload.is_empty() {
            return None;
        }
        if payload.trim() == "[DONE]" {
            self.finished = true;
            return Some(DecodedFrame::Done);
        }

        let Ok(value) = serde_json::from_str::<Value>(&payload) else {
            return Some(DecodedFrame::Raw(payload));
        };
        match unwrap_success(value) {
            Err(error) => Some(DecodedFrame::Error(error)),
            Ok(value) => match stream_error_message(&value) {
                Some(message) => Some(DecodedFrame::Error(APIError::new(500, message))),
                None => Some(DecodedFrame::Data(value)),
            },
        }
    }
}

fn stream_error_message(value: &Value) -> Option<String> {
    if let Some(message) = error_message(value) {
        return Some(message);
    }

    let choice = value.get("choices")?.as_array()?.first()?;
    if choice.get("finish_reason").and_then(Value::as_str) != Some("error") {
        return None;
    }

    choice
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .or_else(|| error.get("code"))
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .map(str::to_owned)
        .or_else(|| Some("Cline stream failed".to_owned()))
}

fn translate_stream<S>(upstream: S) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, EventDecoder, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        EventDecoder::default(),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut pending, mut ended) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, pending, ended))));
            }
            if ended {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    pending.extend(decoder.push(&bytes).into_iter().map(encode_frame));
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
                Ok(None) => {
                    pending.extend(decoder.finish().into_iter().map(encode_frame));
                    ended = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
            }
        }
    });

    Box::pin(events)
}

fn encode_frame(frame: DecodedFrame) -> Bytes {
    match frame {
        DecodedFrame::Data(value) => Bytes::from(format!("data: {value}\n\n")),
        DecodedFrame::Raw(payload) => Bytes::from(format!("data: {payload}\n\n")),
        DecodedFrame::Done => Bytes::from_static(b"data: [DONE]\n\n"),
        DecodedFrame::Error(error) => sse::error_event_bytes(&error),
    }
}

struct Aggregator {
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    completed: Option<Value>,
}

impl Aggregator {
    fn new(model: &str) -> Self {
        Self {
            model: model.to_owned(),
            id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
            arguments: BTreeMap::new(),
            completed: None,
        }
    }

    fn accept(&mut self, frame: DecodedFrame) -> Result<(), APIError> {
        match frame {
            DecodedFrame::Data(value) => self.accept_value(value),
            DecodedFrame::Raw(_) | DecodedFrame::Done => Ok(()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_value(&mut self, value: Value) -> Result<(), APIError> {
        if let Some(message) = stream_error_message(&value) {
            return Err(APIError::new(500, message));
        }
        if value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .is_some()
        {
            self.completed = Some(value);
            return Ok(());
        }
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return Ok(());
        };
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            self.id = id.to_owned();
        }
        if let Some(created) = value.get("created").and_then(Value::as_i64) {
            self.created = created;
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }

        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };
        if let Some(content) = delta.get("content").and_then(Value::as_str) {
            self.content.push_str(content);
        }
        if let Some(reasoning) = delta
            .get("reasoning")
            .or_else(|| delta.get("reasoning_content"))
            .and_then(Value::as_str)
        {
            self.reasoning.push_str(reasoning);
        }

        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_insert_with(|| {
                serde_json::json!({
                    "index": index,
                    "type": "function",
                    "function": { "name": "", "arguments": "" }
                })
            });
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                entry["id"] = Value::String(id.to_owned());
            }
            if let Some(name) = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
            {
                entry["function"]["name"] = Value::String(name.to_owned());
            }
            if let Some(arguments) = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                self.arguments.entry(index).or_default().push_str(arguments);
            }
        }

        Ok(())
    }

    fn finish(mut self, request: &ChatCompletionRequest) -> Result<Value, APIError> {
        if let Some(completed) = self.completed {
            return Ok(completed);
        }

        for (index, arguments) in self.arguments {
            if let Some(call) = self.tool_calls.get_mut(&index) {
                call["function"]["arguments"] = Value::String(arguments);
            }
        }
        let tool_calls: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls.is_empty();
        let mut message = serde_json::json!({
            "role": "assistant",
            "content": self.content,
        });
        if !self.reasoning.is_empty() {
            message["reasoning"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let usage = self
            .usage
            .map(normalize_usage)
            .unwrap_or_else(|| estimate_usage(&request.messages, &self.content).to_openai_json());

        Ok(serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| {
                    if has_tool_calls { "tool_calls".to_owned() } else { "stop".to_owned() }
                }),
            }],
            "usage": usage,
        }))
    }
}

fn normalize_usage(mut usage: Value) -> Value {
    let normalized = UsageBreakdown::from_value(&usage).to_openai_json();
    if let (Some(target), Some(source)) = (usage.as_object_mut(), normalized.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    usage
}

fn estimate_usage(messages: &[ChatMessage], completion: &str) -> UsageBreakdown {
    let prompt_chars: usize = messages
        .iter()
        .map(|message| match &message.content {
            ChatContent::Text(text) => text.chars().count(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref())
                .map(|text| text.chars().count())
                .sum(),
            ChatContent::Null => 0,
        })
        .sum();
    let prompt_tokens = (prompt_chars / 4).max(1) as i64;
    let completion_tokens = (completion.chars().count() / 4).max(1) as i64;

    UsageBreakdown {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ..Default::default()
    }
}

fn random_hex(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    let _ = getrandom::fill(&mut bytes);
    hex::encode(bytes)
}

impl ProviderExecutor for ClineExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        ClineExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        ClineExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
        ClineExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        ClineExecutor::models(self)
    }

    fn model_id_variants(&self, model: &str) -> Vec<String> {
        ClineExecutor::model_id_variants(self, model)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { ClineExecutor::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { ClineExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { ClineExecutor::chat_completion_stream(self, model, request).await })
    }
}

pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(ClineEndpoints::default(), database)
}

pub fn adapter_with_endpoints(
    endpoints: ClineEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;
    Ok(ProviderAdapter::new(ClineExecutor::new(
        endpoints, database, client,
    )))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn request() -> ChatCompletionRequest {
        serde_json::from_value(json!({
            "model": "cline/openai/gpt-5",
            "messages": [{"role": "user", "content": "hello"}]
        }))
        .expect("request parses")
    }

    fn credentials(expires_at: Option<i64>, refreshed_at: Option<i64>) -> ClineCredentials {
        ClineCredentials {
            id: "cline-account".to_owned(),
            access_token: "workos:access".to_owned(),
            refresh_token: Some("workos:refresh".to_owned()),
            token_expires_at: expires_at,
            last_refreshed_at: refreshed_at,
        }
    }

    #[test]
    fn executor_contract_uses_static_metadata_and_public_catalog() {
        let executor = ClineExecutor::new(
            ClineEndpoints::default(),
            None,
            UpstreamClient::new().expect("client"),
        );

        assert_eq!(executor.id(), "cline");
        assert_eq!(executor.keys(), &["cline"]);
        assert_eq!(executor.alias(), "cline");
        assert!(executor.models().is_empty());
        assert!(read_catalog(&executor.catalog).is_empty());
        assert_eq!(
            executor.model_id_variants("cline/OpenAI/GPT-5"),
            vec!["openai/gpt-5"]
        );
    }

    #[test]
    fn request_body_uses_the_bare_model_and_always_streams() {
        let mut body = serde_json::to_value(request()).expect("request serializes");
        let model = strip_cline_prefix("cline/openai/gpt-5");
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(true);

        assert_eq!(body["model"], "openai/gpt-5");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn mandatory_reasoning_models_are_matched_on_the_upstream_key() {
        assert!(model_requires_reasoning(
            "cline-free/muse-spark-1.3-contributor"
        ));
        assert!(model_requires_reasoning(
            "cline/cline-free/Muse-Spark-1.3-Contributor"
        ));
        assert!(!model_requires_reasoning("cline-free/deepseek-v4.1-flash"));
        assert!(!model_requires_reasoning("anthropic/claude-sonnet-5.5"));
    }

    #[test]
    fn disabling_effort_is_dropped_only_where_reasoning_is_mandatory() {
        let mut body = json!({
            "model": "cline-free/muse-spark-1.3-contributor",
            "reasoning_effort": "none",
            "reasoning": {"effort": "none", "summary": "auto"},
            "temperature": 0.2
        });
        strip_reasoning_disables(&mut body);

        assert!(
            body.get("reasoning_effort").is_none(),
            "the disable must not reach an endpoint that mandates reasoning: {body}"
        );
        assert_eq!(body["reasoning"], json!({"summary": "auto"}));
        assert_eq!(body["temperature"], 0.2);

        let mut kept = json!({"reasoning_effort": "low", "reasoning": {"effort": "medium"}});
        strip_reasoning_disables(&mut kept);
        assert_eq!(
            kept,
            json!({"reasoning_effort": "low", "reasoning": {"effort": "medium"}}),
            "a real effort level is the caller's choice and stays untouched"
        );
    }

    #[test]
    fn workos_prefix_is_added_exactly_once() {
        assert_eq!(bearer_token("token"), "Bearer workos:token");
        assert_eq!(bearer_token("workos:token"), "Bearer workos:token");
    }

    #[test]
    fn refresh_due_uses_expiry_lead_and_twelve_hour_fallback() {
        let now = 1_000_000_000;
        assert!(token_refresh_is_due(
            &credentials(Some(now + TOKEN_REFRESH_LEAD_MS), Some(now)),
            now
        ));
        assert!(!token_refresh_is_due(
            &credentials(Some(now + TOKEN_REFRESH_LEAD_MS + 1), Some(now)),
            now
        ));
        assert!(token_refresh_is_due(&credentials(None, None), now));
        assert!(token_refresh_is_due(
            &credentials(None, Some(now - TOKEN_REFRESH_FALLBACK_MS)),
            now
        ));
    }

    #[test]
    fn rfc3339_expiry_is_converted_to_epoch_milliseconds() {
        assert_eq!(
            parse_rfc3339_ms("2023-11-14T22:13:20.123Z"),
            Some(1_700_000_000_123)
        );
        assert_eq!(
            parse_rfc3339_ms("2023-11-14T22:13:20Z"),
            Some(1_700_000_000_000)
        );
    }

    #[test]
    fn a_non_utc_expiry_degrades_to_an_unknown_expiry() {
        assert_eq!(
            parse_rfc3339_ms("2023-11-14T23:13:20+01:00"),
            None,
            "only the UTC shape upstream ships is parsed; anything else leaves the expiry unknown"
        );
        assert_eq!(parse_rfc3339_ms("not a date"), None);
    }

    #[test]
    fn fragmented_events_and_done_are_emitted_once() {
        let mut decoder = EventDecoder::default();
        assert!(decoder.push(b"data: {\"choices\":[{").is_empty());
        let frames = decoder.push(b"\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n");

        assert_eq!(frames.len(), 2);
        assert!(matches!(frames[0], DecodedFrame::Data(_)));
        assert!(matches!(frames[1], DecodedFrame::Done));
        assert!(decoder.finish().is_empty());
    }

    #[test]
    fn both_stream_error_shapes_become_errors() {
        let mut decoder = EventDecoder::default();
        let root = decoder.push(b"data: {\"error\":\"root failure\"}\n\n");
        assert!(
            matches!(&root[0], DecodedFrame::Error(error) if error.message() == "root failure")
        );

        let mut decoder = EventDecoder::default();
        let choice = decoder.push(
            b"data: {\"choices\":[{\"finish_reason\":\"error\",\"error\":{\"message\":\"choice failure\"}}]}\n\n",
        );
        assert!(
            matches!(&choice[0], DecodedFrame::Error(error) if error.message() == "choice failure")
        );
    }

    #[test]
    fn aggregator_reassembles_content_reasoning_tools_and_cost() {
        let mut aggregator = Aggregator::new("openai/gpt-5");
        for value in [
            json!({"choices":[{"delta":{"content":"hel","reasoning":"why "},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"content":"lo","reasoning":"not","tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\"q\""}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5,"cost":0.01}}),
        ] {
            aggregator
                .accept(DecodedFrame::Data(value))
                .expect("chunk accepts");
        }

        let response = aggregator.finish(&request()).expect("response builds");
        assert_eq!(response["choices"][0]["message"]["content"], "hello");
        assert_eq!(response["choices"][0]["message"]["reasoning"], "why not");
        assert_eq!(
            response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            r#"{"q":"rust"}"#
        );
        assert_eq!(response["usage"]["cost"], 0.01);
    }

    #[test]
    fn success_envelopes_unwrap_and_failure_envelopes_error() {
        let mut decoder = EventDecoder::default();
        let frames = decoder.push(
            b"data: {\"success\":true,\"data\":{\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}}\n\n",
        );
        assert!(
            matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "ok")
        );

        let mut decoder = EventDecoder::default();
        let frames = decoder.push(b"data: {\"success\":false,\"error\":\"denied\"}\n\n");
        assert!(matches!(&frames[0], DecodedFrame::Error(error) if error.message() == "denied"));
    }
}
