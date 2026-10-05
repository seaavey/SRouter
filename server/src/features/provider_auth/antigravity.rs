//! The Antigravity Google OAuth authorization-code flow and the token-import
//! path.
//!
//! The browser approves on `accounts.google.com`, then lands on this server's
//! callback with `code` and `state`. The session row carries the PKCE verifier,
//! the client id, and the redirect URI the login used; the exchange sends them
//! back verbatim together with the embedded `client_secret` (the token endpoint
//! rejects PKCE alone for this client).
//!
//! D3 — the redirect URI is pinned to loopback. Live probes proved Google
//! accepts only loopback origins for this client, so `SROUTER_PUBLIC_URL` is
//! **ignored** here (unlike `default_callback_uri`'s public-url branch that the
//! OpenAI route uses). A remote completion flows through the existing
//! `callback_url` paste path instead of a public redirect.
//!
//! D4 — two callback surfaces share one port: the public JSON API under
//! `GET|POST /v1/auth/antigravity/callback`, and a browser HTML page at
//! `GET|POST /auth/antigravity/callback` (mirrors OpenAI/Qoder). The Node
//! `:1455` listener is not ported (single-port ruling, `TODO.md` section 1.4).
//!
//! The token endpoint is injectable through [`AntigravityEndpoints`], attached
//! to the callback routers with `Extension`, so tests point the exchange at a
//! fake upstream exactly like `codebuddy.rs`.
//!
//! Oracle: `apps/api/src/controllers/auth.controller.ts` (`Antigravity`),
//! `apps/api/src/logic/auth.logic.ts` (`ProcessOAuthCallbackFor`,
//! `ProcessTokenImportFor`, `BuildAccountIdentity`),
//! `apps/api/src/services/authHandlers.ts` (`AuthHandlers.Antigravity`), and
//! `packages/providers/src/oauth/antigravity.ts` (`AntigravityOAuth`).

use axum::Extension;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Serialize;
use serde_json::Value;

use super::{
    CallbackResponse, ConnectedProvider, LoginResponse, Protocol, account_suffix, error_page,
    parse_callback, pkce_challenge, pkce_verifier, query_params, require_database, success_page,
    text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::antigravity::types::{
    ANTIGRAVITY_OAUTH_AUTHORIZE_URL, ANTIGRAVITY_OAUTH_CLIENT_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET,
    ANTIGRAVITY_OAUTH_PROMPT, ANTIGRAVITY_OAUTH_SCOPE, ANTIGRAVITY_PROVIDER, AntigravityEndpoints,
};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, cleanup_expired_sessions, delete_session, release_session,
    save_session,
};
use crate::infrastructure::database::providers::{
    AntigravityConnectionWrite, upsert_antigravity_connection,
};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

/// Routes the admin session guards: starting a login and importing a token.
pub fn create_antigravity_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/antigravity/login", get(login))
        .route("/auth/antigravity/token", post(import_token))
}

/// The public JSON callback route, which the contract leaves unguarded.
pub fn create_antigravity_callback_router() -> Router<AppState> {
    create_antigravity_callback_router_with_endpoints(AntigravityEndpoints::default())
}

/// The public JSON callback with injectable upstream endpoints, so a test can
/// point the token exchange at a fake without touching the network.
pub fn create_antigravity_callback_router_with_endpoints(
    endpoints: AntigravityEndpoints,
) -> Router<AppState> {
    Router::new()
        .route("/auth/antigravity/callback", get(callback).post(callback))
        .layer(Extension(endpoints))
}

/// The browser-facing callback page, mounted at the application root beside the
/// OpenAI and Qoder ones. It renders the same completion as HTML so the
/// operator sees the outcome without copying the redirected URL anywhere.
pub fn create_antigravity_callback_pages_router() -> Router<AppState> {
    create_antigravity_callback_pages_router_with_endpoints(AntigravityEndpoints::default())
}

/// The browser callback page with injectable upstream endpoints.
pub fn create_antigravity_callback_pages_router_with_endpoints(
    endpoints: AntigravityEndpoints,
) -> Router<AppState> {
    Router::new()
        .route(
            "/auth/antigravity/callback",
            get(callback_page).post(callback_page),
        )
        .layer(Extension(endpoints))
}

#[derive(Serialize)]
struct TokenImportResponse {
    success: bool,
    message: &'static str,
    provider: ConnectedProvider,
}

/// Starts a login: a session row plus the URL the browser opens.
async fn login(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, APIError> {
    let params = query_params(query.as_deref());
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    cleanup_expired_sessions(database, now_ms() - SESSION_TTL_MS).await?;

    let client_id = params
        .get("client_id")
        .cloned()
        .unwrap_or_else(|| ANTIGRAVITY_OAUTH_CLIENT_ID.to_owned());
    // D3: the redirect is loopback-pinned. A caller-supplied URI passes through
    // untouched; `SROUTER_PUBLIC_URL` never rewrites it.
    let redirect_uri = params
        .get("redirect_uri")
        .cloned()
        .unwrap_or_else(|| default_redirect_uri(&state.config));
    let prompt = params
        .get("prompt")
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(ANTIGRAVITY_OAUTH_PROMPT);

    let code_verifier = pkce_verifier();
    let state_token = uuid::Uuid::new_v4().to_string();
    save_session(
        database,
        &state_token,
        &code_verifier,
        &client_id,
        &redirect_uri,
    )
    .await?;

    let authorize_url = authorize_url(
        &client_id,
        &redirect_uri,
        prompt,
        &pkce_challenge(&code_verifier),
        &state_token,
    );
    let body = LoginResponse {
        authorize_url,
        state: state_token,
        code_verifier,
        redirect_uri,
    };

    if params.get("format").map(String::as_str) == Some("json") {
        return Ok(Json(body).into_response());
    }

    Ok(Redirect::to(&body.authorize_url).into_response())
}

/// The public JSON callback: claims the session, exchanges the code, stores the
/// connection.
async fn callback(
    State(state): State<AppState>,
    Extension(endpoints): Extension<AntigravityEndpoints>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Response, APIError> {
    let provider = complete_callback(&state, &endpoints, query.as_deref(), &body).await?;

    Ok(Json(CallbackResponse {
        success: true,
        message: constants::providers::antigravity::OAUTH_SUCCESS,
        provider,
    })
    .into_response())
}

/// The browser callback: the same completion, rendered as a page.
async fn callback_page(
    State(state): State<AppState>,
    Extension(endpoints): Extension<AntigravityEndpoints>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    match complete_callback(&state, &endpoints, query.as_deref(), &body).await {
        Ok(provider) => success_page(constants::providers::antigravity::OAUTH_SUCCESS, &provider),
        Err(error) => error_page(&error),
    }
}

/// Claims the session, exchanges the code for tokens, and stores the connection.
/// The claim is released on a failed exchange so the operator can retry instead
/// of losing the login.
async fn complete_callback(
    state: &AppState,
    endpoints: &AntigravityEndpoints,
    query: Option<&str>,
    body: &[u8],
) -> Result<ConnectedProvider, APIError> {
    let parsed = parse_callback(query, body)?;
    let database = require_database(state, constants::providers::oauth::DATABASE_REQUIRED)?;

    let session = claim_session(database, &parsed.state)
        .await?
        .ok_or_else(|| APIError::new(500, constants::providers::oauth::INVALID_OR_EXPIRED_STATE))?;

    let client_id = if session.client_id.trim().is_empty() {
        ANTIGRAVITY_OAUTH_CLIENT_ID.to_owned()
    } else {
        session.client_id.clone()
    };
    let tokens = match exchange_code(
        endpoints,
        &client_id,
        &session.redirect_uri,
        &parsed.code,
        &session.code_verifier,
    )
    .await
    {
        Ok(tokens) => tokens,
        Err(error) => {
            release_session(database, &parsed.state).await?;
            return Err(error);
        }
    };

    let timestamp = now_ms();
    let id = format!("antigravity_{timestamp}");
    let name = tokens
        .email
        .clone()
        .unwrap_or_else(|| unnamed_account(timestamp));
    // Store before consuming the session: a failed write releases the claim so
    // the operator can retry the login, instead of losing the OAuth state.
    let provider = match store_connection(state, database, &tokens, id, name).await {
        Ok(provider) => provider,
        Err(error) => {
            release_session(database, &parsed.state).await?;
            return Err(error);
        }
    };
    delete_session(database, &parsed.state).await?;

    Ok(provider)
}

/// Imports a token the operator pasted: validated JSON, a stored connection,
/// and `201`.
async fn import_token(State(state): State<AppState>, body: Bytes) -> Result<Response, APIError> {
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| APIError::new(400, constants::providers::antigravity::INVALID_JSON_BODY))?;
    if !payload.is_object() {
        return Err(APIError::new(
            400,
            constants::providers::antigravity::INVALID_JSON_BODY,
        ));
    }

    let access_token = text_field(&payload, "accessToken")
        .or_else(|| text_field(&payload, "access_token"))
        .ok_or_else(|| {
            APIError::new(400, constants::providers::antigravity::MISSING_ACCESS_TOKEN)
        })?;
    let id_token = text_field(&payload, "idToken").or_else(|| text_field(&payload, "id_token"));
    let timestamp = now_ms();
    let id = format!("antigravity_{timestamp}");
    let email = id_token
        .as_deref()
        .and_then(email_from_token)
        .or_else(|| email_from_token(&access_token));
    let name = text_field(&payload, "name")
        .or(email)
        .unwrap_or_else(|| unnamed_account(timestamp));

    let tokens = AntigravityTokens {
        access_token,
        refresh_token: text_field(&payload, "refreshToken")
            .or_else(|| text_field(&payload, "refresh_token")),
        expires_at_ms: None,
        email: None,
    };
    let provider = store_connection(&state, database, &tokens, id, name).await?;

    Ok((
        StatusCode::CREATED,
        Json(TokenImportResponse {
            success: true,
            message: constants::providers::antigravity::TOKEN_IMPORT_SUCCESS,
            provider,
        }),
    )
        .into_response())
}

/// The exchanged Google tokens plus the identity read from the id token.
struct AntigravityTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at_ms: Option<i64>,
    email: Option<String>,
}

/// Runs the authorization-code exchange against the (injectable) token
/// endpoint. Google requires `client_secret` even with PKCE, so it is always
/// sent.
async fn exchange_code(
    endpoints: &AntigravityEndpoints,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<AntigravityTokens, APIError> {
    let form = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("code", code)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("client_id", client_id)
        .append_pair("client_secret", ANTIGRAVITY_OAUTH_CLIENT_SECRET)
        .append_pair("code_verifier", code_verifier)
        .finish();
    let client = UpstreamClient::new()?;
    let response = client
        .raw()
        .post(&endpoints.token_url)
        .timeout(client.request_timeout())
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::providers::antigravity::exchange_transport_failed(&error),
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(APIError::new(
            500,
            constants::providers::antigravity::exchange_failed(status.as_u16()),
        ));
    }

    let access_token = text_field(&payload, "access_token").ok_or_else(|| {
        APIError::new(500, constants::providers::antigravity::EMPTY_TOKEN_RESPONSE)
    })?;
    let id_token = text_field(&payload, "id_token");
    let email = id_token
        .as_deref()
        .and_then(email_from_token)
        .or_else(|| email_from_token(&access_token));
    let expires_at_ms = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .map(|seconds| now_ms() + seconds.saturating_mul(1000));

    Ok(AntigravityTokens {
        access_token,
        refresh_token: text_field(&payload, "refresh_token"),
        expires_at_ms,
        email,
    })
}

/// Stores the connection row and lets the registry pick the new catalog up.
async fn store_connection(
    state: &AppState,
    database: &AppDatabase,
    tokens: &AntigravityTokens,
    id: String,
    name: String,
) -> Result<ConnectedProvider, APIError> {
    let timestamp = now_ms();
    upsert_antigravity_connection(
        database,
        &AntigravityConnectionWrite {
            id: id.clone(),
            name: name.clone(),
            access_token: tokens.access_token.clone(),
            refresh_token: tokens.refresh_token.clone(),
            expires_at: tokens.expires_at_ms,
            project_id: None,
        },
    )
    .await?;

    state.providers.maybe_refresh_catalogs(true).await;

    Ok(ConnectedProvider {
        id,
        provider_id: ANTIGRAVITY_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at: timestamp,
    })
}

/// The loopback redirect a login uses when the caller did not supply one. D3:
/// `SROUTER_PUBLIC_URL` is deliberately ignored, because Google rejects any
/// non-loopback redirect for this client.
fn default_redirect_uri(config: &crate::config::APIConfig) -> String {
    format!(
        "http://localhost:{}/v1/auth/antigravity/callback",
        config.port
    )
}

/// Builds the browser authorization URL with the parameters the Node oracle
/// sends: PKCE S256, offline access, and the consent prompt.
fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    prompt: &str,
    challenge: &str,
    state: &str,
) -> String {
    let mut url =
        url::Url::parse(ANTIGRAVITY_OAUTH_AUTHORIZE_URL).expect("static authorize endpoint");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("scope", ANTIGRAVITY_OAUTH_SCOPE);
        query.append_pair("code_challenge", challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("state", state);
        query.append_pair("access_type", "offline");
        query.append_pair("prompt", prompt);
    }

    url.to_string()
}

/// The JSON payload of a JWT, without verifying its signature. The Node oracle
/// reads identity claims the same way (`ExtractEmailFromToken`).
fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload.as_bytes()).ok()?;

    serde_json::from_slice(&decoded).ok()
}

/// The account email an id or access token carries, in the order the Node
/// oracle checks the claims.
fn email_from_token(token: &str) -> Option<String> {
    let claims = jwt_claims(token)?;
    let email_like = |value: &Value| {
        value
            .as_str()
            .map(str::to_owned)
            .filter(|value| value.contains('@'))
    };

    if let Some(email) = claims.get("email").and_then(email_like) {
        return Some(email);
    }
    if let Some(email) = claims
        .get("https://api.openai.com/profile")
        .and_then(|profile| profile.get("email"))
        .and_then(email_like)
    {
        return Some(email);
    }
    if let Some(email) = claims
        .get("user_metadata")
        .and_then(|metadata| metadata.get("email"))
        .and_then(email_like)
    {
        return Some(email);
    }
    for key in ["preferred_username", "unique_name"] {
        if let Some(email) = claims.get(key).and_then(email_like) {
            return Some(email);
        }
    }

    None
}

/// The label an unnamed account gets, matching the Node `BuildAccountIdentity`
/// fallback (`Antigravity (Account #<last 4 of ms>)`).
fn unnamed_account(timestamp: i64) -> String {
    format!("Antigravity (Account #{})", account_suffix(timestamp))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    use super::{authorize_url, email_from_token, unnamed_account};
    use crate::features::provider_auth::LoginResponse;

    fn fake_id_token(email: &str) -> String {
        let payload = json!({ "email": email }).to_string();

        format!("header.{}.signature", URL_SAFE_NO_PAD.encode(payload))
    }

    #[test]
    fn the_authorize_url_carries_the_google_oauth_parameters() {
        let url = authorize_url(
            "client-1",
            "http://localhost:3000/v1/auth/antigravity/callback",
            "consent",
            "challenge-1",
            "state-1",
        );

        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=client-1"));
        assert!(url.contains(
            "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fauth%2Fantigravity%2Fcallback"
        ));
        assert!(url.contains(
            "scope=openid+profile+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform"
        ));
        assert!(url.contains("code_challenge=challenge-1"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-1"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
    }

    #[test]
    fn the_login_response_uses_the_camel_case_field_names() {
        let body = LoginResponse {
            authorize_url: "https://example.test/authorize".to_owned(),
            state: "state-1".to_owned(),
            code_verifier: "verifier-1".to_owned(),
            redirect_uri: "http://localhost:3000/v1/auth/antigravity/callback".to_owned(),
        };
        let value = serde_json::to_value(body).expect("login response serializes");

        assert_eq!(value["authorizeUrl"], "https://example.test/authorize");
        assert_eq!(value["state"], "state-1");
        assert_eq!(value["codeVerifier"], "verifier-1");
        assert_eq!(
            value["redirectUri"],
            "http://localhost:3000/v1/auth/antigravity/callback"
        );
    }

    #[test]
    fn the_identity_is_read_from_the_id_token_claims() {
        let token = fake_id_token("dev@example.com");

        assert_eq!(email_from_token(&token).as_deref(), Some("dev@example.com"));
        assert!(email_from_token("not-a-jwt").is_none());
    }

    #[test]
    fn an_unnamed_account_gets_the_numbered_label() {
        assert_eq!(
            unnamed_account(1_772_400_000_000),
            "Antigravity (Account #0000)"
        );
    }
}
