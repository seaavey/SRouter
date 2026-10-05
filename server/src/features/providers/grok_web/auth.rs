//! Grok Web session establishment: page probe for `x-userid`, credential load,
//! and the `session.create` → `conversation.attached` → `response.create`
//! WebSocket handshake.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use super::executor::GrokWebExecutor;
use super::transport::{GrokSocket, event_error_message};
use super::types::{GROK_WEB_USER_AGENT, session_capabilities};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::providers::{GrokWebCredentials, load_grok_web_credentials};

/// Upper bound for the whole establishment phase (page probe excluded): WebSocket
/// handshake plus `session.create`/`conversation.attached` round trip. The live
/// client attaches in milliseconds; 15s only guards a wedged upstream.
pub(super) const DEFAULT_SESSION_TIMEOUT: Duration = Duration::from_secs(15);

/// Client for the `x-userid` page probe: redirect policy `none` so an invalid
/// cookie's `307` to `accounts.x.ai` stays visible as a status instead of
/// being followed and masked by a foreign `200`.
pub fn probe_client() -> Result<reqwest::Client, APIError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(GROK_WEB_USER_AGENT)
        .build()
        .map_err(|error| {
            APIError::new(
                500,
                constants::providers::grok_web::page_probe_transport_failed(&error),
            )
        })
}

/// GETs `page_url` with the `sso` cookie and returns the issued `x-userid`.
/// Shared by the executor and the connect route so both validate a cookie the
/// same way.
pub async fn probe_uid(
    client: &reqwest::Client,
    page_url: &str,
    sso: &str,
    timeout: Duration,
) -> Result<String, APIError> {
    let response = client
        .get(page_url)
        .header(reqwest::header::COOKIE, format!("sso={sso}"))
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                APIError::new(
                    500,
                    constants::providers::grok_web::page_probe_transport_failed("timed out"),
                )
            } else {
                APIError::new(
                    500,
                    constants::providers::grok_web::page_probe_transport_failed(&error),
                )
            }
        })?;

    let status = response.status();
    if status.is_redirection() || status.as_u16() == 401 {
        return Err(APIError::new(
            401,
            constants::providers::grok_web::COOKIE_INVALID,
        ));
    }
    if status.as_u16() == 429 {
        return Err(APIError::new(
            429,
            constants::providers::grok_web::page_probe_failed(429),
        ));
    }
    if !status.is_success() {
        return Err(APIError::new(
            500,
            constants::providers::grok_web::page_probe_failed(status.as_u16()),
        ));
    }

    response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|cookie| {
            cookie
                .strip_prefix("x-userid=")
                .map(|rest| rest.split(';').next().unwrap_or(rest).to_owned())
        })
        .filter(|uid| !uid.is_empty())
        .ok_or_else(|| APIError::new(401, constants::providers::grok_web::UID_NOT_ISSUED))
}

/// Establishment state: a connected socket that has completed
/// `response.create`, ready to yield frames.
pub(super) struct Session {
    pub(super) ws: GrokSocket,
}

impl GrokWebExecutor {
    /// Loads credentials, probes the page for `x-userid`, opens the WebSocket,
    /// runs `session.create`, waits for `conversation.attached`, and sends
    /// `response.create`. The whole span is bounded by `session_timeout`.
    pub(super) async fn establish(
        &self,
        model_id: &str,
        prompt: &str,
    ) -> Result<Session, APIError> {
        let credentials = self.credentials().await?;
        let uid = self.fetch_uid(&credentials.sso).await?;

        tokio::time::timeout(self.session_timeout, async {
            let mut ws = self.connect_ws(&uid, &credentials.sso).await?;
            send_json(
                &mut ws,
                &json!({
                    "event": {
                        "type": "session.create",
                        "event_id": format!("evt_init_{}", uuid::Uuid::new_v4()),
                        "session": {
                            "model": model_id,
                            "x_grok": session_capabilities()
                        }
                    }
                }),
            )
            .await?;

            let session_id = wait_for_attach(&mut ws).await?;

            send_json(
                &mut ws,
                &json!({
                    "session_id": session_id,
                    "event": {
                        "type": "response.create",
                        "event_id": format!("evt_resp_{}", now_ms()),
                        "item": {
                            "type": "message",
                            "role": "user",
                            "x_grok": {
                                "client_message_id": uuid::Uuid::new_v4().to_string(),
                                "input_chunks": [{ "text": { "text": prompt } }]
                            }
                        }
                    }
                }),
            )
            .await?;

            Ok::<_, APIError>(Session { ws })
        })
        .await
        .map_err(|_| APIError::new(500, constants::providers::grok_web::SESSION_TIMEOUT))?
    }

    async fn credentials(&self) -> Result<GrokWebCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::grok_web::DATABASE_REQUIRED))?;

        load_grok_web_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::grok_web::NOT_CONNECTED))
    }

    /// Probes the page for the `x-userid` cookie the WebSocket query string
    /// requires. Redirects are not followed: a valid session answers `200`
    /// plus the cookie, an invalid one answers `307` to `accounts.x.ai`.
    async fn fetch_uid(&self, sso: &str) -> Result<String, APIError> {
        probe_uid(
            &self.probe_client,
            &self.endpoints.page_url,
            sso,
            self.session_timeout,
        )
        .await
    }

    async fn connect_ws(&self, uid: &str, sso: &str) -> Result<GrokSocket, APIError> {
        let url = format!("{}?uid={}", self.endpoints.ws_url, uid);
        let mut request = url.as_str().into_client_request().map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;

        let cookie = format!("sso={sso}; sso-rw={sso}; x-userid={uid}");
        let headers = [
            ("Cookie", cookie),
            ("Origin", "https://grok.com".to_owned()),
            ("User-Agent", GROK_WEB_USER_AGENT.to_owned()),
        ];
        for (name, value) in headers {
            let value = HeaderValue::from_str(&value)
                .map_err(|_| APIError::new(401, constants::providers::grok_web::COOKIE_INVALID))?;
            request.headers_mut().insert(name, value);
        }

        let (ws, _) = connect_async(request).await.map_err(handshake_error)?;
        Ok(ws)
    }
}

/// Maps a failed WebSocket handshake onto the frozen error envelope. The
/// observed failure for a dead cookie is HTTP 401 on the upgrade.
fn handshake_error(error: tokio_tungstenite::tungstenite::Error) -> APIError {
    use tokio_tungstenite::tungstenite::Error;

    match error {
        Error::Http(response) => match response.status().as_u16() {
            401 | 403 => APIError::new(401, constants::providers::grok_web::COOKIE_INVALID),
            429 => APIError::new(429, constants::providers::grok_web::handshake_failed(429)),
            status => APIError::new(
                500,
                constants::providers::grok_web::handshake_failed(status),
            ),
        },
        other => APIError::new(
            500,
            constants::providers::grok_web::handshake_failed_message(&other),
        ),
    }
}

async fn send_json(ws: &mut GrokSocket, value: &Value) -> Result<(), APIError> {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|error| APIError::new(500, constants::providers::upstream_stream_failed(&error)))
}

/// Reads events until `conversation.attached` yields the session id. Ignoring
/// the interleaved `session.created`/queue events matches what the live client
/// tolerates.
async fn wait_for_attach(ws: &mut GrokSocket) -> Result<String, APIError> {
    loop {
        let message = ws
            .next()
            .await
            .ok_or_else(|| APIError::new(500, constants::providers::grok_web::STREAM_ENDED))?
            .map_err(|error| {
                APIError::new(500, constants::providers::upstream_stream_failed(&error))
            })?;

        let Message::Text(text) = message else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(text.as_ref()) else {
            continue;
        };

        if let Some(session_id) = value.get("session_id").and_then(Value::as_str)
            && value["event"]["type"] == "conversation.attached"
        {
            return Ok(session_id.to_owned());
        }
        if let Some(message) = event_error_message(&value) {
            return Err(APIError::new(500, message));
        }
    }
}
