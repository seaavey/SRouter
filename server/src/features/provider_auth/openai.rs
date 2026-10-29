//! The OpenAI Codex authorization-code flow and the token-import path.
//!
//! The browser approves on `auth.openai.com`, then lands on this server's
//! callback with `code` and `state`. The session row carries the PKCE verifier
//! and the redirect URI the login used, which the exchange sends back verbatim.
//!
//! Single-port deviation (owner ruling, `TODO.md` section 1.4): the Node
//! gateway finished the flow on a secondary `:1455` listener where the default
//! redirect is `http://localhost:1455/auth/callback`. Rust has no OAuth
//! listener, so the redirect stays that registered loopback URI and
//! `SROUTER_PUBLIC_URL` deliberately does not rewrite it: the client
//! allow-lists loopback only, and a public origin is refused before the sign-in
//! page loads. The browser therefore ends on the operator's own loopback, and
//! the code is finished by pasting that URL into the dashboard, which posts it
//! to `/v1/auth/openai/callback`.
//!
//! Oracle: `apps/api/src/controllers/auth.controller.ts` (`AuthController.OpenAI`),
//! `apps/api/src/logic/auth.logic.ts` (`InitiatePKCEFor`,
//! `ProcessOAuthCallbackFor`, `ProcessTokenImportFor`), and
//! `apps/api/src/services/authHandlers.ts` (`AuthHandlers.OpenAI`).

use super::{
    CallbackResponse, ConnectedProvider, LoginResponse, Protocol, TokenImportResponse,
    account_suffix, email_from_token, error_page, jwt_claims, parse_callback, parse_import_body,
    pkce_challenge, query_params, require_database, start_login_session, success_page, text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::codex::types::{
    CODEX_AUTHORIZE_URL, CODEX_OAUTH_CLIENT_ID, CODEX_OAUTH_SCOPE, CODEX_ORIGINATOR,
    CODEX_PROVIDER, CODEX_REDIRECT_URI, CodexEndpoints,
};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    claim_session, delete_session, release_session,
};
use crate::infrastructure::database::providers::{CodexConnectionWrite, upsert_codex_connection};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::Value;

/// Routes the admin session guards: starting a login and importing a token.
pub fn create_openai_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/openai/login", get(login))
        .route("/auth/openai/token", post(import_token))
}

/// The public JSON callback route, which the contract leaves unguarded.
pub fn create_openai_callback_router() -> Router<AppState> {
    Router::new().route("/auth/openai/callback", get(callback).post(callback))
}

/// The browser-facing callback pages, mounted at the application root rather
/// than under `/v1`. `auth.openai.com` only accepts the Codex redirects
/// `http://127.0.0.1:{1455,1457}/auth/callback`, so `/auth/callback` is the path
/// that can actually finish the flow from the browser; `/auth/openai/callback`
/// is an alias for symmetry. Reaching them needs the vendor redirect to point
/// at this server — a local run on port 1455, or an `ssh -L 1455:...` tunnel
/// from the client machine.
pub fn create_openai_callback_pages_router() -> Router<AppState> {
    Router::new()
        .route("/auth/callback", get(callback_page).post(callback_page))
        .route(
            "/auth/openai/callback",
            get(callback_page).post(callback_page),
        )
}

/// Starts a login: a session row plus the URL the browser opens.
async fn login(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, APIError> {
    let params = query_params(query.as_deref());
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;

    let client_id = params
        .get("client_id")
        .cloned()
        .unwrap_or_else(|| CODEX_OAUTH_CLIENT_ID.to_owned());
    // Loopback-pinned: the client rejects anything else before the sign-in page,
    // so `SROUTER_PUBLIC_URL` never rewrites this.
    let redirect_uri = params
        .get("redirect_uri")
        .map(|uri| uri.trim())
        .filter(|uri| !uri.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| CODEX_REDIRECT_URI.to_owned());
    let prompt = params.get("prompt").cloned();

    let session = start_login_session(database, &client_id, &redirect_uri).await?;

    let authorize_url = authorize_url(
        &client_id,
        &redirect_uri,
        prompt.as_deref(),
        &pkce_challenge(&session.code_verifier),
        &session.state,
    );
    let body = LoginResponse {
        authorize_url,
        state: session.state,
        code_verifier: session.code_verifier,
        redirect_uri,
    };

    if params.get("format").map(String::as_str) == Some("json") {
        return Ok(Json(body).into_response());
    }

    Ok(Redirect::to(&body.authorize_url).into_response())
}

/// The public JSON callback: claims the session, exchanges the code for tokens,
/// and stores the connection.
async fn callback(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Response, APIError> {
    let provider = complete_callback(&state, query.as_deref(), &body).await?;

    Ok(Json(CallbackResponse {
        success: true,
        message: constants::providers::openai::OAUTH_SUCCESS,
        provider,
    })
    .into_response())
}

/// The browser callback: the same completion, rendered as a page so the
/// operator sees the outcome without copying the redirected URL anywhere.
async fn callback_page(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    match complete_callback(&state, query.as_deref(), &body).await {
        Ok(provider) => success_page(constants::providers::openai::OAUTH_SUCCESS, &provider),
        Err(error) => error_page(&error),
    }
}

/// Claims the session, exchanges the code for tokens, and stores the connection.
/// The claim is released on a failed exchange so the operator can retry instead
/// of losing the login.
async fn complete_callback(
    state: &AppState,
    query: Option<&str>,
    body: &[u8],
) -> Result<ConnectedProvider, APIError> {
    let parsed = parse_callback(query, body)?;
    let database = require_database(state, constants::providers::oauth::DATABASE_REQUIRED)?;

    let session = claim_session(database, &parsed.state)
        .await?
        .ok_or_else(|| APIError::new(500, constants::providers::oauth::INVALID_OR_EXPIRED_STATE))?;

    let client_id = if session.client_id.trim().is_empty() {
        CODEX_OAUTH_CLIENT_ID.to_owned()
    } else {
        session.client_id.clone()
    };
    let tokens = match exchange_code(
        &codex_endpoints(state),
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

    delete_session(database, &parsed.state).await?;

    let timestamp = now_ms();
    let id = format!("openai_codex_{timestamp}");
    let name = tokens
        .email
        .clone()
        .unwrap_or_else(|| unnamed_account(timestamp));
    store_connection(state, database, &tokens, id, name).await
}

/// Imports a token the operator pasted: validated JSON, a stored connection,
/// and `201`.
async fn import_token(State(state): State<AppState>, body: Bytes) -> Result<Response, APIError> {
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    let (payload, access_token) = parse_import_body(&body)?;

    let id_token = text_field(&payload, "idToken").or_else(|| text_field(&payload, "id_token"));
    let timestamp = now_ms();
    let id = text_field(&payload, "id").unwrap_or_else(|| format!("openai_codex_{timestamp}"));
    let email = id_token
        .as_deref()
        .and_then(email_from_token)
        .or_else(|| email_from_token(&access_token))
        .or_else(|| payload.get("user").and_then(|u| text_field(u, "email")));
    let name = text_field(&payload, "name")
        .or(email)
        .unwrap_or_else(|| unnamed_account(timestamp));

    let account_id = text_field(&payload, "accountId")
        .or_else(|| text_field(&payload, "account_id"))
        .or_else(|| payload.get("account").and_then(|a| text_field(a, "id")))
        .or_else(|| id_token.as_deref().and_then(account_id_from_token))
        .or_else(|| account_id_from_token(&access_token));

    let tokens = CodexTokens {
        access_token,
        refresh_token: text_field(&payload, "refreshToken")
            .or_else(|| text_field(&payload, "refresh_token"))
            .or_else(|| text_field(&payload, "sessionToken"))
            .or_else(|| text_field(&payload, "session_token")),
        account_id,
        expires_at_ms: None,
        email: None,
    };
    let provider = store_connection(&state, database, &tokens, id, name).await?;

    Ok((
        StatusCode::CREATED,
        Json(TokenImportResponse {
            success: true,
            message: constants::providers::openai::TOKEN_IMPORT_SUCCESS,
            provider,
        }),
    )
        .into_response())
}

/// The exchanged ChatGPT tokens plus the identity read from the id token.
struct CodexTokens {
    access_token: String,
    refresh_token: Option<String>,
    account_id: Option<String>,
    expires_at_ms: Option<i64>,
    email: Option<String>,
}

/// Runs the authorization-code exchange against the vendor token endpoint.
async fn exchange_code(
    endpoints: &CodexEndpoints,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<CodexTokens, APIError> {
    let form = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("code", code)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("client_id", client_id)
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
                constants::providers::openai::exchange_transport_failed(&error),
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(APIError::new(
            500,
            constants::providers::openai::exchange_failed(status.as_u16()),
        ));
    }

    let access_token = text_field(&payload, "access_token")
        .ok_or_else(|| APIError::new(500, constants::providers::openai::EMPTY_TOKEN_RESPONSE))?;
    let id_token = text_field(&payload, "id_token");
    let email = id_token
        .as_deref()
        .and_then(email_from_token)
        .or_else(|| email_from_token(&access_token));
    let account_id = id_token.as_deref().and_then(account_id_from_token);
    let expires_at_ms = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .map(|seconds| now_ms() + seconds.saturating_mul(1000));

    Ok(CodexTokens {
        access_token,
        refresh_token: text_field(&payload, "refresh_token"),
        account_id,
        expires_at_ms,
        email,
    })
}

/// Stores the connection row and advertises the Codex catalog.
async fn store_connection(
    state: &AppState,
    database: &AppDatabase,
    tokens: &CodexTokens,
    id: String,
    name: String,
) -> Result<ConnectedProvider, APIError> {
    let timestamp = now_ms();
    upsert_codex_connection(
        database,
        &CodexConnectionWrite {
            id: id.clone(),
            name: name.clone(),
            access_token: tokens.access_token.clone(),
            refresh_token: tokens.refresh_token.clone(),
            account_id: tokens.account_id.clone(),
            token_expires_at: tokens.expires_at_ms,
        },
    )
    .await?;

    state.providers.maybe_refresh_catalogs(true).await;

    Ok(ConnectedProvider {
        id,
        provider_id: CODEX_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at: timestamp,
    })
}

/// Builds the browser authorization URL with the parameters the official client
/// sends (binary literals): PKCE S256, the organization claim flag, the
/// simplified flow, and the `originator` the vendor keys on.
fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    prompt: Option<&str>,
    challenge: &str,
    state: &str,
) -> String {
    let mut url = url::Url::parse(CODEX_AUTHORIZE_URL).expect("static authorize endpoint");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("scope", CODEX_OAUTH_SCOPE);
        query.append_pair("code_challenge", challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("state", state);
        query.append_pair("id_token_add_organizations", "true");
        query.append_pair("codex_cli_simplified_flow", "true");
        query.append_pair("originator", CODEX_ORIGINATOR);
        if let Some(prompt) = prompt.filter(|value| !value.is_empty()) {
            query.append_pair("prompt", prompt);
        }
    }

    url.to_string()
}

/// The ChatGPT account id the `chatgpt-account-id` header is built from. It
/// lives under the vendor's auth claim on the id token.
fn account_id_from_token(token: &str) -> Option<String> {
    let claims = jwt_claims(token)?;

    claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .or_else(|| claims.get("chatgpt_account_id").and_then(Value::as_str))
        .map(str::to_owned)
        .filter(|value| !value.trim().is_empty())
}

/// The label an unnamed account gets, matching the Node fallback.
fn unnamed_account(timestamp: i64) -> String {
    format!("OpenAI Codex (Account #{})", account_suffix(timestamp))
}

fn codex_endpoints(state: &AppState) -> CodexEndpoints {
    state.providers.codex_endpoints().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    use super::{
        account_id_from_token, account_suffix, authorize_url, email_from_token, unnamed_account,
    };

    fn fake_id_token(email: &str, account_id: &str) -> String {
        let payload = json!({
            "email": email,
            "https://api.openai.com/auth": {"chatgpt_account_id": account_id},
        })
        .to_string();

        format!("header.{}.signature", URL_SAFE_NO_PAD.encode(payload))
    }

    #[test]
    fn the_authorize_url_carries_the_codex_oauth_parameters() {
        let url = authorize_url(
            "app_test",
            "http://localhost:3000/v1/auth/openai/callback",
            Some("login"),
            "challenge-1",
            "state-1",
        );

        assert!(url.starts_with("https://auth.openai.com/oauth/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=app_test"));
        assert!(url.contains("code_challenge=challenge-1"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-1"));
        // The scope set the current vendor client sends, connectors included.
        assert!(url.contains("scope=openid+profile+email+offline_access"));
        assert!(url.contains("api.connectors.read"));
        assert!(url.contains("codex_cli_simplified_flow=true"));
        assert!(url.contains("originator=codex_cli_rs"));
        assert!(url.contains("prompt=login"));
    }

    #[test]
    fn a_login_without_a_prompt_omits_the_parameter() {
        let url = authorize_url("app_test", "http://localhost/cb", None, "c", "s");

        assert!(!url.contains("prompt="));
    }

    #[test]
    fn the_identity_is_read_from_the_id_token_claims() {
        let token = fake_id_token("dev@example.com", "acct-42");

        assert_eq!(email_from_token(&token).as_deref(), Some("dev@example.com"));
        assert_eq!(account_id_from_token(&token).as_deref(), Some("acct-42"));
        assert!(email_from_token("not-a-jwt").is_none());
    }

    #[test]
    fn an_unnamed_account_gets_the_numbered_label() {
        assert_eq!(account_suffix(1_772_400_000_000), "0000");
        assert_eq!(
            unnamed_account(1_772_400_000_000),
            "OpenAI Codex (Account #0000)"
        );
    }
}
