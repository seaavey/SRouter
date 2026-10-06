//! The Claude Code OAuth authorization-code flow and the token-import path.
//!
//! The browser approves on `claude.ai/oauth/authorize`, then lands on this
//! server's callback with `code` and `state`. The session row carries the PKCE
//! verifier, the client id, and the redirect URI the login used; the exchange
//! sends them back verbatim as a JSON body (Claude OAuth takes `client_id` only,
//! no client secret).
//!
//! The redirect is the main listener's `/v1/auth/claude/callback`, rewritten
//! onto `SROUTER_PUBLIC_URL` when set, exactly like the OpenAI route and
//! `apps/api/src/utils/callbackUrl.ts`. The Node `:1455` listener is not ported
//! (single-port ruling, `TODO.md` section 1.4).
//!
//! The token endpoint is injectable through [`ClaudeEndpoints`], attached to the
//! callback routers with `Extension`, so tests point the exchange at a fake
//! upstream exactly like `antigravity.rs`.
//!
//! Oracle: `apps/api/src/controllers/auth.controller.ts` (`AuthController.Claude`),
//! `apps/api/src/logic/auth.logic.ts` (`InitiatePKCEFor`,
//! `ProcessOAuthCallbackFor`, `ProcessTokenImportFor`),
//! `apps/api/src/services/authHandlers.ts` (`AuthHandlers.Claude`), and
//! `packages/providers/src/oauth/claude.ts` (`ClaudeOAuth`).

use axum::Extension;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Value, json};

use super::{
    CallbackResponse, ConnectedProvider, LoginResponse, Protocol, account_suffix,
    default_callback_uri, error_page, parse_callback, pkce_challenge, pkce_verifier, query_params,
    require_database, resolve_callback_url, success_page, text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::claude::types::{
    CLAUDE_OAUTH_AUTHORIZE_URL, CLAUDE_OAUTH_CLIENT_ID, CLAUDE_OAUTH_SCOPE, CLAUDE_PROVIDER,
    ClaudeEndpoints,
};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, cleanup_expired_sessions, delete_session, release_session,
    save_session,
};
use crate::infrastructure::database::providers::{ClaudeConnectionWrite, upsert_claude_connection};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

/// Routes the admin session guards: starting a login and importing a token.
pub fn create_claude_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/claude/login", get(login))
        .route("/auth/claude/token", post(import_token))
}

/// The public JSON callback route, which the contract leaves unguarded.
pub fn create_claude_callback_router() -> Router<AppState> {
    create_claude_callback_router_with_endpoints(ClaudeEndpoints::default())
}

/// The public JSON callback with injectable upstream endpoints, so a test can
/// point the token exchange at a fake without touching the network.
pub fn create_claude_callback_router_with_endpoints(
    endpoints: ClaudeEndpoints,
) -> Router<AppState> {
    Router::new()
        .route("/auth/claude/callback", get(callback).post(callback))
        .layer(Extension(endpoints))
}

/// The browser-facing callback page, mounted at the application root beside the
/// OpenAI, Qoder, and Antigravity ones. It renders the same completion as HTML.
pub fn create_claude_callback_pages_router() -> Router<AppState> {
    create_claude_callback_pages_router_with_endpoints(ClaudeEndpoints::default())
}

/// The browser callback page with injectable upstream endpoints.
pub fn create_claude_callback_pages_router_with_endpoints(
    endpoints: ClaudeEndpoints,
) -> Router<AppState> {
    Router::new()
        .route(
            "/auth/claude/callback",
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
        .or_else(|| std::env::var("CLAUDE_OAUTH_CLIENT_ID").ok())
        .unwrap_or_else(|| CLAUDE_OAUTH_CLIENT_ID.to_owned());
    let redirect_uri = params
        .get("redirect_uri")
        .map(|uri| resolve_callback_url(uri, &state.config))
        .unwrap_or_else(|| default_callback_uri(&state.config, "/auth/claude/callback"));
    let scope = params
        .get("scope")
        .cloned()
        .unwrap_or_else(|| CLAUDE_OAUTH_SCOPE.to_owned());
    let prompt = params.get("prompt").cloned();

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
        &scope,
        prompt.as_deref(),
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
    Extension(endpoints): Extension<ClaudeEndpoints>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Response, APIError> {
    let provider = complete_callback(&state, &endpoints, query.as_deref(), &body).await?;

    Ok(Json(CallbackResponse {
        success: true,
        message: constants::providers::claude::OAUTH_SUCCESS,
        provider,
    })
    .into_response())
}

/// The browser callback: the same completion, rendered as a page.
async fn callback_page(
    State(state): State<AppState>,
    Extension(endpoints): Extension<ClaudeEndpoints>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    match complete_callback(&state, &endpoints, query.as_deref(), &body).await {
        Ok(provider) => success_page(constants::providers::claude::OAUTH_SUCCESS, &provider),
        Err(error) => error_page(&error),
    }
}

/// Claims the session, exchanges the code for tokens, and stores the connection.
/// The claim is released on a failed exchange so the operator can retry.
async fn complete_callback(
    state: &AppState,
    endpoints: &ClaudeEndpoints,
    query: Option<&str>,
    body: &[u8],
) -> Result<ConnectedProvider, APIError> {
    let parsed = parse_callback(query, body)?;
    let database = require_database(state, constants::providers::oauth::DATABASE_REQUIRED)?;

    let session = claim_session(database, &parsed.state)
        .await?
        .ok_or_else(|| APIError::new(500, constants::providers::oauth::INVALID_OR_EXPIRED_STATE))?;

    let client_id = if session.client_id.trim().is_empty() {
        CLAUDE_OAUTH_CLIENT_ID.to_owned()
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
    let id = format!("claude_{timestamp}");
    let name = unnamed_account(timestamp);
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
        .map_err(|_| APIError::new(400, constants::providers::claude::INVALID_JSON_BODY))?;
    if !payload.is_object() {
        return Err(APIError::new(
            400,
            constants::providers::claude::INVALID_JSON_BODY,
        ));
    }

    let access_token = text_field(&payload, "accessToken")
        .or_else(|| text_field(&payload, "access_token"))
        .ok_or_else(|| APIError::new(400, constants::providers::claude::MISSING_ACCESS_TOKEN))?;
    let timestamp = now_ms();
    let id = text_field(&payload, "id").unwrap_or_else(|| format!("claude_{timestamp}"));
    let name = text_field(&payload, "name").unwrap_or_else(|| unnamed_account(timestamp));

    let tokens = ClaudeTokens {
        access_token,
        refresh_token: text_field(&payload, "refreshToken")
            .or_else(|| text_field(&payload, "refresh_token")),
        organization_id: text_field(&payload, "organizationId")
            .or_else(|| text_field(&payload, "organization_id")),
        expires_at_ms: None,
    };
    let provider = store_connection(&state, database, &tokens, id, name).await?;

    Ok((
        StatusCode::CREATED,
        Json(TokenImportResponse {
            success: true,
            message: constants::providers::claude::TOKEN_IMPORT_SUCCESS,
            provider,
        }),
    )
        .into_response())
}

/// The exchanged Claude tokens.
struct ClaudeTokens {
    access_token: String,
    refresh_token: Option<String>,
    organization_id: Option<String>,
    expires_at_ms: Option<i64>,
}

/// Runs the authorization-code exchange against the (injectable) token
/// endpoint. Claude OAuth takes a JSON body with `client_id` only.
async fn exchange_code(
    endpoints: &ClaudeEndpoints,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<ClaudeTokens, APIError> {
    let body = json!({
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
    });
    let client = UpstreamClient::new()?;
    let response = client
        .raw()
        .post(&endpoints.token_url)
        .timeout(client.request_timeout())
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::providers::claude::exchange_transport_failed(&error),
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(APIError::new(
            500,
            constants::providers::claude::exchange_failed(status.as_u16()),
        ));
    }

    let access_token = text_field(&payload, "access_token")
        .ok_or_else(|| APIError::new(500, constants::providers::claude::EMPTY_TOKEN_RESPONSE))?;
    let expires_at_ms = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .map(|seconds| now_ms() + seconds.saturating_mul(1000));

    Ok(ClaudeTokens {
        access_token,
        refresh_token: text_field(&payload, "refresh_token"),
        organization_id: text_field(&payload, "organization_id"),
        expires_at_ms,
    })
}

/// Stores the connection row and lets the registry pick the new catalog up.
async fn store_connection(
    state: &AppState,
    database: &AppDatabase,
    tokens: &ClaudeTokens,
    id: String,
    name: String,
) -> Result<ConnectedProvider, APIError> {
    let timestamp = now_ms();
    upsert_claude_connection(
        database,
        &ClaudeConnectionWrite {
            id: id.clone(),
            name: name.clone(),
            access_token: tokens.access_token.clone(),
            refresh_token: tokens.refresh_token.clone(),
            expires_at: tokens.expires_at_ms,
            organization_id: tokens.organization_id.clone(),
        },
    )
    .await?;

    state.providers.maybe_refresh_catalogs(true).await;

    Ok(ConnectedProvider {
        id,
        provider_id: CLAUDE_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::Anthropic,
        enabled: true,
        created_at: timestamp,
    })
}

/// Builds the browser authorization URL with the parameters the Node oracle
/// sends: PKCE S256 and, when the caller asked for one, a `prompt`.
fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    scope: &str,
    prompt: Option<&str>,
    challenge: &str,
    state: &str,
) -> String {
    let mut url = url::Url::parse(CLAUDE_OAUTH_AUTHORIZE_URL).expect("static authorize endpoint");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("scope", scope);
        query.append_pair("code_challenge", challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("state", state);
        if let Some(prompt) = prompt.filter(|value| !value.is_empty()) {
            query.append_pair("prompt", prompt);
        }
    }

    url.to_string()
}

/// The label an unnamed account gets, matching the Node `BuildAccountIdentity`
/// fallback (`Claude Code (Account #<last 4 of ms>)`).
fn unnamed_account(timestamp: i64) -> String {
    format!("Claude Code (Account #{})", account_suffix(timestamp))
}

#[cfg(test)]
mod tests {
    use super::{authorize_url, unnamed_account};

    #[test]
    fn the_authorize_url_carries_the_claude_oauth_parameters() {
        let url = authorize_url(
            "client-1",
            "http://localhost:3000/v1/auth/claude/callback",
            "org:create_api_key user:profile user:inference",
            Some("login"),
            "challenge-1",
            "state-1",
        );

        assert!(url.starts_with("https://claude.ai/oauth/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=client-1"));
        assert!(url.contains(
            "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fauth%2Fclaude%2Fcallback"
        ));
        assert!(url.contains("scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference"));
        assert!(url.contains("code_challenge=challenge-1"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-1"));
        assert!(url.contains("prompt=login"));
    }

    #[test]
    fn a_login_without_a_prompt_omits_the_parameter() {
        let url = authorize_url("client-1", "http://localhost/cb", "s", None, "c", "st");

        assert!(!url.contains("prompt="));
    }

    #[test]
    fn an_unnamed_account_gets_the_numbered_label() {
        assert_eq!(
            unnamed_account(1_772_400_000_000),
            "Claude Code (Account #0000)"
        );
    }
}
