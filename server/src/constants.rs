//! Central wire copy for the API: every message, error code, error type, and
//! header name or value a client can observe.
//!
//! Wording lives here so a copy change touches one file; call sites only
//! reference these items. The [`code`] and [`error_type`] modules own the
//! machine-readable halves of the error envelope, and [`headers`] owns the
//! frozen response headers, so the observable contract is reviewable in one
//! place instead of being scattered across handlers.
//!
//! Messages that interpolate values are functions rather than constants,
//! because `format!` only accepts a literal as its format string. They take the
//! interpolated values as typed arguments, so the shape of each message is
//! visible from its signature.

/// `error.code` values on the error envelope. Stable identifiers clients switch
/// on, unlike the human-readable [`super::json`]/[`super::common`] messages.
pub mod code {
    /// Generic `400` code the Node error handler attaches to every
    /// `HTTPException` at status 400 (`apps/api/src/index.ts:75-84`).
    pub const INVALID_REQUEST: &str = "invalid_request";
    /// Request-body validation codes from the frozen `ChatCompletionRequestSchema`.
    pub const INVALID_TYPE: &str = "invalid_type";
    pub const TOO_BIG: &str = "too_big";
    pub const TOO_SMALL: &str = "too_small";

    /// Body and JSON parsing.
    pub const INVALID_JSON: &str = "invalid_json";
    pub const REQUEST_TOO_LARGE: &str = "request_too_large";
    pub const INVALID_PAYLOAD: &str = "invalid_payload";

    /// API-key authentication and accounting.
    pub const INVALID_API_KEY: &str = "invalid_api_key";
    pub const MISSING_API_KEY: &str = "missing_api_key";
    pub const API_KEY_DISABLED: &str = "api_key_disabled";
    pub const INSUFFICIENT_CREDIT: &str = "insufficient_credit";
    pub const QUOTA_EXCEEDED: &str = "quota_exceeded";
    pub const MODEL_NOT_ALLOWED: &str = "model_not_allowed";

    /// Model catalog.
    pub const MODEL_NOT_FOUND: &str = "model_not_found";
    pub const MODEL_NOT_SUPPORTED: &str = "model_not_supported";

    /// Rate limiting.
    pub const RATE_LIMIT_EXCEEDED: &str = "rate_limit_exceeded";
    pub const LOGIN_RATE_LIMITED: &str = "login_rate_limited";

    /// Admin authentication.
    pub const AUTHENTICATION_REQUIRED: &str = "authentication_required";
    pub const INVALID_CREDENTIALS: &str = "invalid_credentials";
    pub const INVALID_PASSWORD: &str = "invalid_password";
    pub const PASSWORD_MISMATCH: &str = "password_mismatch";
    pub const PASSWORD_UPDATE_FAILED: &str = "password_update_failed";
    pub const SETUP_LOCAL_ONLY: &str = "setup_local_only";
    pub const SETUP_ALREADY_COMPLETE: &str = "setup_already_complete";

    /// Cross-origin guard.
    pub const CSRF_ORIGIN_REJECTED: &str = "csrf_origin_rejected";

    /// Upstream provider failure.
    pub const UPSTREAM_UNAVAILABLE: &str = "upstream_unavailable";
}

/// `error.type` values, used when a handler overrides the status-derived
/// default from [`crate::error::APIError::new`].
pub mod error_type {
    pub const INVALID_REQUEST: &str = "invalid_request_error";
    pub const INSUFFICIENT_QUOTA: &str = "insufficient_quota";
    pub const UPSTREAM: &str = "upstream_error";
}

/// Response headers the API freezes: custom names beyond `axum::http::header`,
/// plus every value that is part of the published contract.
pub mod headers {
    /// Custom header names. Standard names come from `axum::http::header`.
    pub mod name {
        pub const X_POWERED_BY: &str = "x-powered-by";
        pub const X_VERSION: &str = "x-version";
        pub const X_CONTENT_TYPE_OPTIONS: &str = "x-content-type-options";
        pub const X_FRAME_OPTIONS: &str = "x-frame-options";
        pub const X_XSS_PROTECTION: &str = "x-xss-protection";
        pub const REFERRER_POLICY: &str = "referrer-policy";
        pub const X_ACCEL_BUFFERING: &str = "x-accel-buffering";
    }

    pub mod value {
        /// Security headers (`docs/api-v1-contract.md`).
        pub const POWERED_BY: &str = "Seaavey";
        pub const CONTENT_TYPE_OPTIONS: &str = "nosniff";
        pub const FRAME_OPTIONS: &str = "DENY";
        pub const XSS_PROTECTION: &str = "1; mode=block";
        pub const REFERRER_POLICY: &str = "strict-origin-when-cross-origin";

        /// CORS preflight and response headers.
        pub const ALLOWED_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
        pub const ALLOWED_HEADERS: &str =
            "Content-Type, Authorization, x-api-key, anthropic-version";
        pub const EXPOSE_HEADERS: &str = "Content-Length, X-Request-Id, X-Version";
        pub const MAX_AGE_SECONDS: &str = "86400";
        pub const VARY_PREFLIGHT: &str = "Origin, Access-Control-Request-Headers";
        pub const VARY_ORIGIN: &str = "Origin";
        pub const ALLOW_CREDENTIALS: &str = "true";

        /// Server-sent event streams.
        pub const EVENT_STREAM: &str = "text/event-stream";
        pub const SSE_CACHE_CONTROL: &str = "no-cache, no-transform";
        pub const ACCEL_BUFFERING_OFF: &str = "no";
        pub const KEEP_ALIVE: &str = "keep-alive";

        /// Model catalog caching.
        pub const MODEL_CACHE_CONTROL: &str = "public, max-age=60, stale-while-revalidate=300";
    }
}

/// Request-body parsing and the standard error envelope.
pub mod json {
    /// Canonical message for an unhandled malformed-JSON body: Node maps an
    /// unhandled `SyntaxError` to this text (`apps/api/src/index.ts:88-99`).
    pub const MALFORMED: &str = "Malformed JSON in request body";
    /// The `ValidateJson` middleware wording, still used by the Anthropic
    /// messages route which parses its own body
    /// (`apps/api/src/middleware/Validation.ts`).
    pub const MALFORMED_VERIFY: &str = "Malformed JSON in request body. Please verify JSON syntax.";
    /// A body that parsed as empty rather than malformed.
    pub const EMPTY_BODY: &str = "Request body cannot be empty. Valid JSON is required.";
    /// Shared by every route that caps the body it reads.
    pub const TOO_LARGE: &str = "Request body too large";
}

/// Copy shared by more than one area.
pub mod common {
    /// A payload that failed validation but is not malformed JSON.
    pub const INVALID_PAYLOAD: &str = "Invalid payload";
    /// Fallback message for an unexpected failure.
    pub const INTERNAL_SERVER_ERROR: &str = "Internal server error";
}

/// Admin authentication and account lifecycle (`/v1/admin/*`).
pub mod admin {
    pub const AUTH_REQUIRED: &str = "Admin authentication is required";
    pub const INVALID_PASSWORD: &str = "Invalid admin password";
    pub const TOO_MANY_ATTEMPTS: &str = "Too many failed login attempts";
    pub const SETUP_COMPLETED: &str = "Admin setup has already been completed";
    pub const SETUP_LOCAL_ONLY: &str = "Admin setup is only available from the local machine";
    pub const INVALID_SETUP_PAYLOAD: &str = "Invalid setup payload";
    pub const CURRENT_PASSWORD_INCORRECT: &str = "Current admin password is incorrect";
    pub const FAILED_TO_UPDATE_PASSWORD: &str = "Failed to update admin password";
    pub const PASSWORD_UPDATED: &str = "Admin password updated successfully";
    pub const PASSWORD_REQUIRED: &str = "Password is required";
    pub const PASSWORD_CONFIRMATION_REQUIRED: &str = "Password confirmation is required";
    pub const CURRENT_PASSWORD_REQUIRED: &str = "Current password is required";
    pub const NEW_PASSWORD_REQUIRED: &str = "New password is required";
    pub const PASSWORD_CONFIRMATION_MISMATCH: &str = "Password confirmation does not match";
    pub const NEW_PASSWORD_CONFIRMATION_MISMATCH: &str = "New password confirmation does not match";
    pub const PASSWORD_TOO_LONG: &str = "Password must be at most 128 characters";
    pub const PERSISTENCE_NOT_CONFIGURED: &str = "admin persistence is not configured";

    pub fn could_not_salt_password(error: impl std::fmt::Display) -> String {
        format!("could not salt the password: {error}")
    }

    pub fn invalid_scrypt_parameters(error: impl std::fmt::Display) -> String {
        format!("invalid scrypt parameters: {error}")
    }

    pub fn scrypt_failed(error: impl std::fmt::Display) -> String {
        format!("scrypt failed: {error}")
    }

    pub fn could_not_generate_session(error: impl std::fmt::Display) -> String {
        format!("could not generate a session: {error}")
    }

    pub fn could_not_build_session_cookie(error: impl std::fmt::Display) -> String {
        format!("could not build the session cookie: {error}")
    }

    pub fn could_not_build_cleared_cookie(error: impl std::fmt::Display) -> String {
        format!("could not build the cleared cookie: {error}")
    }
}

/// API-key authentication and its rejections.
pub mod api_key {
    pub const INVALID: &str = "Invalid SRouter API Key";
    pub const DISABLED: &str = "The provided SRouter API Key is disabled";
    pub const CREDIT_EXCEEDED: &str =
        "Insufficient credit balance. Your credit limit has been reached.";
    pub const QUOTA_EXCEEDED: &str =
        "Token quota exceeded. Your lifetime token limit has been reached.";
    /// Rejection when the reserved per-request budget cannot fit the key quota
    /// (`reserveAPIKeyQuotaDB` in the Node chat controller).
    pub const RESERVATION_UNAVAILABLE: &str =
        "Token quota exceeded. The requested budget is unavailable.";
    pub const MISSING_LOCAL: &str = "Missing SRouter API Key. Please provide a valid key via 'Authorization: Bearer ***' header or disable 'Require API Key' in Settings.";
    pub const MISSING_REMOTE: &str = "Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer ***' or 'x-api-key'.";

    pub fn model_not_allowed(model: &str) -> String {
        format!("Model '{model}' is not allowed for this API key")
    }
}

/// Key management (`/v1/keys`).
pub mod keys {
    pub const INVALID_PAYLOAD: &str = "Invalid API key payload";
    pub const INVALID_CREDIT_PAYLOAD: &str = "Invalid credit payload";
    pub const DELETED: &str = "API Key revoked and deleted successfully";
    pub const NAME_REQUIRED: &str = "Field 'name' is required";
    pub const NAME_EMPTY: &str = "Field 'name' cannot be empty";
    pub const AMOUNT_REQUIRED: &str = "Field 'amount' is required";
    pub const AMOUNT_POSITIVE: &str = "Amount must be greater than 0";
    pub const PERSISTENCE_NOT_CONFIGURED: &str = "API-key persistence is not configured";

    pub fn not_found(id: impl std::fmt::Display) -> String {
        format!("Key '{id}' not found")
    }

    pub fn could_not_encode_allowed_models(error: impl std::fmt::Display) -> String {
        format!("could not encode allowed_models: {error}")
    }

    pub fn could_not_generate_secret(error: impl std::fmt::Display) -> String {
        format!("could not generate a key secret: {error}")
    }
}

/// Shared HTTP middleware rejections (auth, CSRF, rate limit, body limit).
pub mod middleware {
    pub const CSRF_REJECTED: &str = "Cross-origin admin mutation is not allowed";

    pub fn rate_limit_exceeded(limit: u32) -> String {
        format!(
            "Rate limit exceeded: this API key allows {limit} request{} per minute.",
            if limit == 1 { "" } else { "s" }
        )
    }
}

/// The gateway: chat completions, messages, and the model catalog.
pub mod gateway {
    pub const MODEL_REQUIRED: &str = "Missing required parameter 'model'";
    pub const MESSAGES_REQUIRED: &str = "Missing required parameter 'messages'";
    pub const PROMPT_REQUIRED: &str = "Missing required parameter 'prompt'";
    pub const MODEL_ID_REQUIRED: &str = "Model ID parameter is required";
    pub const MESSAGES_EMPTY: &str = "messages: at least 1 message is required";
    pub const COULD_NOT_BUILD_STREAM: &str = "Could not build the stream response";

    pub fn model_not_registered(model: &str) -> String {
        format!("No provider is registered for model '{model}'")
    }

    pub fn model_not_found(model: &str) -> String {
        format!("Model '{model}' not found")
    }

    pub fn model_not_supported_image(model: &str) -> String {
        format!(
            "Model '{model}' does not support image generation. Output modalities do not include 'image'."
        )
    }

    pub fn model_not_supported_image_edit(model: &str) -> String {
        format!("Model '{model}' does not support image editing / image-to-image input.")
    }

    pub fn invalid_request_body(error: impl std::fmt::Display) -> String {
        format!("Invalid request body: {error}")
    }

    pub fn could_not_build_stream(error: impl std::fmt::Display) -> String {
        format!("could not build the stream response: {error}")
    }

    /// Messages mirroring the frozen Zod schema errors in
    /// `ChatCompletionRequestSchema`.
    pub mod schema {
        pub const STRING_MIN_1: &str = "String must contain at least 1 character(s)";
        pub const STRING_MAX_300: &str = "String must contain at most 300 character(s)";
        pub const STRING_MAX_1000: &str = "String must contain at most 1000 character(s)";
        pub const STRING_MAX_64: &str = "String must contain at most 64 character(s)";
        pub const NUMBER_MIN_1: &str = "Number must be greater than or equal to 1";
        pub const NUMBER_MAX_8: &str = "Number must be less than or equal to 8";
        pub const NUMBER_MAX_1000000: &str = "Number must be less than or equal to 1000000";
        pub const ARRAY_MAX_128: &str = "Array must contain at most 128 element(s)";
        pub const ARRAY_MAX_16: &str = "Array must contain at most 16 element(s)";
        pub const EXPECTED_OBJECT: &str = "Invalid input: expected object";
        pub const MESSAGES_NOT_EMPTY: &str = "Parameter 'messages' cannot be empty";
        pub const MESSAGES_MAX_1000: &str =
            "Parameter 'messages' exceeds the maximum of 1000 entries";
        pub const MAX_TOKENS_ABOVE_CAP: &str = "Parameter 'max_tokens' exceeds the gateway maximum";
        pub const CONTENT_DESCRIPTION: &str = "a string, an array of content parts, or null";

        pub fn number_min(min: f64) -> String {
            format!("Number must be greater than or equal to {min}")
        }

        pub fn number_max(max: f64) -> String {
            format!("Number must be less than or equal to {max}")
        }
    }
}

/// Provider registry, connections, and upstream adapters.
pub mod providers {
    pub const DATABASE_REQUIRED: &str =
        "no database is configured; provider changes cannot be persisted";
    pub const PERSISTENCE_NOT_CONFIGURED: &str =
        "the PostgreSQL backend has no provider stores yet; schema v2 is SQLite-only";

    pub fn not_found(provider_id: impl std::fmt::Display) -> String {
        format!("Provider '{provider_id}' not found")
    }

    pub fn upstream_error(status: u16, detail: &str) -> String {
        format!("OpenAI Provider Error ({status}): {detail}")
    }

    pub fn upstream_stream_error(status: u16, detail: &str) -> String {
        format!("OpenAI Provider Stream Error ({status}): {detail}")
    }

    pub fn upstream_stalled(seconds: u64) -> String {
        format!("Provider Stream Error: upstream stalled for {seconds}s")
    }

    pub fn upstream_stream_failed(error: impl std::fmt::Display) -> String {
        format!("Provider Stream Error: {error}")
    }

    pub fn could_not_build_request(error: impl std::fmt::Display) -> String {
        format!("could not build the upstream request: {error}")
    }

    pub fn could_not_decode_response(error: impl std::fmt::Display) -> String {
        format!("could not decode the upstream response: {error}")
    }

    pub fn request_failed(error: impl std::fmt::Display) -> String {
        format!("upstream request failed: {error}")
    }

    pub fn request_timed_out(error: impl std::fmt::Display) -> String {
        format!("upstream request timed out: {error}")
    }

    pub fn could_not_parse_tools(error: impl std::fmt::Display) -> String {
        format!("could not parse default OpenCode tools: {error}")
    }

    /// Messages shared by every provider OAuth route: the callback carrier and
    /// the state lifecycle. Wording is frozen against `apps/api`
    /// (`AuthController.CallbackFor`, `AuthLogic.ProcessOAuthCallbackFor`).
    pub mod oauth {
        pub const CALLBACK_MISSING_PARAMS: &str =
            "Missing required 'code' or 'state' parameters in OAuth callback";
        pub const INVALID_OR_EXPIRED_STATE: &str = "Invalid or expired OAuth state parameter";
        pub const DATABASE_REQUIRED: &str =
            "no database is configured; the OAuth session cannot be stored";
    }

    /// Messages of the `openai_codex` OAuth routes: starting the authorization
    /// code flow and importing a token. Wording is frozen against
    /// `apps/api/src/services/authHandlers.ts` (`AuthHandlers.OpenAI`).
    pub mod openai {
        pub const OAUTH_SUCCESS: &str = "Login OpenAI Codex Berhasil!";
        pub const TOKEN_IMPORT_SUCCESS: &str =
            "OpenAI Codex Access Token registered and saved directly to SQLite database!";
        pub const MISSING_ACCESS_TOKEN: &str = "Missing required 'accessToken' parameter";
        pub const INVALID_JSON_BODY: &str = "Invalid JSON body";
        pub const EMPTY_TOKEN_RESPONSE: &str =
            "OpenAI Codex token exchange returned no access token";

        pub fn exchange_failed(status: u16) -> String {
            format!("OpenAI Codex token exchange failed ({status})")
        }

        pub fn exchange_transport_failed(error: impl std::fmt::Display) -> String {
            format!("OpenAI Codex token exchange failed: {error}")
        }
    }

    /// Messages of the `qoder` provider: the device flow, the credential load,
    /// and the COSY signer. Every string a client can see lives here.
    pub mod qoder {
        pub const MISSING_UID: &str =
            "the Qoder connection has no user id; reconnect the Qoder account";
        pub const MISSING_TOKEN: &str =
            "the Qoder connection has no access token; reconnect the Qoder account";
        pub const MISSING_STATE: &str = "Missing state parameter";
        pub const SESSION_EXPIRED: &str = "Session expired or not found";
        pub const EMPTY_TOKEN: &str = "Qoder device token poll returned empty token";
        pub const CALLBACK_MISSING_PARAMS: &str =
            "Missing required 'code' or 'state' parameters in OAuth callback";
        pub const NOT_CONNECTED: &str =
            "No active Qoder connection found. Connect the Qoder account in the Providers tab.";
        pub const TOKEN_EXPIRED: &str =
            "The Qoder device token has expired; reconnect the Qoder account.";

        pub fn key_unreadable(error: impl std::fmt::Display) -> String {
            format!("could not read the Qoder signing key: {error}")
        }

        pub fn key_wrapping_failed(error: impl std::fmt::Display) -> String {
            format!("could not wrap the Qoder request key: {error}")
        }

        pub fn poll_failed(status: u16, detail: &str) -> String {
            format!("Qoder device token poll failed ({status}): {detail}")
        }

        pub fn userinfo_failed(status: u16) -> String {
            format!("Qoder userinfo request failed ({status})")
        }

        pub fn poll_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Qoder device token poll failed: {error}")
        }
    }

    /// Messages of the `cline` provider: the WorkOS device flow, the credential
    /// load, and the lazy refresh. Every string a client can see lives here.
    pub mod cline {
        pub const MISSING_STATE: &str = "Missing state parameter";
        pub const SESSION_EXPIRED: &str = "Session expired or not found";
        pub const EMPTY_TOKEN: &str = "Cline token registration returned an empty access token";
        pub const INVALID_WORKOS_TOKEN_RESPONSE: &str = "Invalid WorkOS token response";
        pub const NOT_CONNECTED: &str =
            "No active Cline connection found. Connect the Cline account in the Providers tab.";
        pub const TOKEN_EXPIRED: &str = "The Cline token has expired; reconnect the Cline account.";
        pub const OUT_OF_CREDITS: &str =
            "The Cline account is out of credits; top it up at app.cline.bot.";
        pub const DATABASE_REQUIRED: &str =
            "no database is configured; the Cline connection cannot be read";

        pub fn device_auth_failed(status: u16) -> String {
            format!("Cline device authorization failed ({status})")
        }

        pub fn device_auth_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Cline device authorization failed: {error}")
        }

        pub fn poll_failed(status: u16) -> String {
            format!("Cline device token poll failed ({status})")
        }

        pub fn poll_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Cline device token poll failed: {error}")
        }

        pub fn register_failed(status: u16) -> String {
            format!("Cline token registration failed ({status})")
        }

        pub fn register_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Cline token registration failed: {error}")
        }

        pub fn refresh_failed(status: u16) -> String {
            format!("Cline token refresh failed ({status})")
        }

        pub fn refresh_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Cline token refresh failed: {error}")
        }
    }

    /// Messages of the `codex` provider: the credential load and the lazy
    /// refresh of the ChatGPT OAuth session. Every string a client can see
    /// lives here — none of them may contain the token.
    pub mod codex {
        pub const NOT_CONNECTED: &str = "No active OpenAI Codex connection found. Connect the OpenAI Codex account in the Providers tab.";
        pub const TOKEN_EXPIRED: &str =
            "The OpenAI Codex token has expired; reconnect the OpenAI Codex account.";
        pub const DATABASE_REQUIRED: &str =
            "no database is configured; the OpenAI Codex connection cannot be read";

        pub fn refresh_failed(status: u16) -> String {
            format!("OpenAI Codex token refresh failed ({status})")
        }

        pub fn refresh_transport_failed(error: impl std::fmt::Display) -> String {
            format!("OpenAI Codex token refresh failed: {error}")
        }
    }

    /// Messages of the `grok-web` provider: the SSO cookie load, the uid page
    /// probe, the WebSocket handshake, and the session lifecycle. Every string
    /// a client can see lives here — none of them may contain the cookie.
    pub mod grok_web {
        pub const NOT_CONNECTED: &str = "No active Grok Web connection found. Connect the Grok Web account in the Providers tab.";
        pub const DATABASE_REQUIRED: &str =
            "no database is configured; the Grok Web connection cannot be read";
        pub const COOKIE_INVALID: &str = "The Grok Web session cookie is invalid or has expired; reconnect the Grok Web account.";
        pub const UID_NOT_ISSUED: &str =
            "Grok Web did not issue a user id for this session; reconnect the Grok Web account.";
        pub const SESSION_TIMEOUT: &str = "Grok Web did not attach a conversation in time";
        pub const HANDSHAKE_FAILED: &str = "Grok Web WebSocket handshake failed";
        pub const EMPTY_QUERY: &str = "Empty query after processing";
        pub const COOKIE_PAYLOAD_INVALID: &str = "Expected the session cookie as a JSON field ('cookie', 'sso', or 'api_key'), as a raw text body, or as a multipart file upload";
        pub const COOKIE_VALUE_INVALID: &str = "The extracted 'sso' cookie value is empty, too long, or contains characters a cookie value may not carry";
        pub const STREAM_ENDED: &str = "Grok Web stream ended before the response completed";
        pub const UNSUPPORTED_CONTENT: &str = "The grok-web provider accepts text content only; image or file parts are not supported";

        pub fn page_probe_failed(status: u16) -> String {
            format!("Grok Web session probe failed ({status})")
        }

        pub fn page_probe_transport_failed(error: impl std::fmt::Display) -> String {
            format!("Grok Web session probe failed: {error}")
        }

        pub fn handshake_failed(status: u16) -> String {
            format!("Grok Web WebSocket handshake failed ({status})")
        }

        pub fn handshake_failed_message(error: impl std::fmt::Display) -> String {
            format!("Grok Web WebSocket handshake failed: {error}")
        }

        pub fn response_failed(reason: &str) -> String {
            format!("Grok Web response did not complete: {reason}")
        }
    }
}

/// `/v1/settings`.
pub mod settings {
    pub const INVALID_PAYLOAD: &str = "Invalid settings payload";
    pub const DATABASE_REQUIRED: &str = "no database is configured; settings cannot be persisted";
}

/// `/v1/logs` and the usage event stream.
pub mod logs {
    pub const TOO_MANY_STREAMS: &str = "Too many usage event streams";
    pub const DATABASE_REQUIRED: &str = "request log database is not configured";
    pub const INVALID_WINDOW: &str = "Invalid window parameter";

    pub fn not_found(raw_id: impl std::fmt::Display) -> String {
        format!("Log '{raw_id}' not found")
    }
}

/// Persistence failures. Every one of these surfaces as a `500` envelope, so
/// the text is client-visible even though the cause is internal.
pub mod database {
    pub const ADMIN_UNSUPPORTED: &str =
        "the PostgreSQL backend has no admin stores yet; schema v2 is SQLite-only";
    pub const API_KEYS_UNSUPPORTED: &str =
        "the PostgreSQL backend has no API-key stores yet; schema v2 is SQLite-only";
    pub const PROVIDERS_UNSUPPORTED: &str =
        "the PostgreSQL backend has no provider stores yet; schema v2 is SQLite-only";
    pub const REQUEST_LOGS_UNSUPPORTED: &str =
        "request log repository is not supported for PostgreSQL";
    pub const API_KEYS_MISSING_COLUMNS: &str =
        "the api_keys table has neither a 'key' nor a 'key_hash' column";
    pub const PROVIDERS_MISSING_COLUMNS: &str =
        "the providers table has neither an 'api_key' nor a 'credentials' column";
    pub const INVALID_STATUS_PARAMETER: &str = "Invalid status parameter";
    pub const SETTINGS_DATABASE_REQUIRED: &str =
        "no database is configured; settings cannot be persisted";
    pub const OAUTH_SESSIONS_DATABASE_REQUIRED: &str =
        "no database is configured; the OAuth session cannot be persisted";
    pub const OAUTH_SESSIONS_UNSUPPORTED: &str =
        "the PostgreSQL backend has no OAuth session store yet; schema v3 is SQLite-only";

    /// Prefixes a diagnostic action to a driver error: `read an API key: ...`.
    pub fn with_context(context: impl std::fmt::Display, error: impl std::fmt::Display) -> String {
        format!("{context}: {error}")
    }

    pub fn column_unreadable(
        column: impl std::fmt::Display,
        error: impl std::fmt::Display,
    ) -> String {
        format!("column '{column}' is unreadable: {error}")
    }

    pub fn legacy_value_missing(column: impl std::fmt::Display) -> String {
        format!("a legacy row has no usable value in column '{column}'")
    }

    pub fn could_not_connect_to_postgres(error: impl std::fmt::Display) -> String {
        format!("could not connect to PostgreSQL: {error}")
    }

    pub fn could_not_open_sqlite(error: impl std::fmt::Display) -> String {
        format!("could not open the SQLite database: {error}")
    }

    pub fn could_not_aggregate_request_logs_by_model(error: impl std::fmt::Display) -> String {
        format!("could not aggregate request logs by model: {error}")
    }

    pub fn could_not_aggregate_request_logs(error: impl std::fmt::Display) -> String {
        format!("could not aggregate request logs: {error}")
    }

    pub fn could_not_count_request_logs(error: impl std::fmt::Display) -> String {
        format!("could not count request logs: {error}")
    }

    pub fn could_not_generate_log_uuid(error: impl std::fmt::Display) -> String {
        format!("could not generate request log UUID: {error}")
    }

    pub fn could_not_insert_request_log(error: impl std::fmt::Display) -> String {
        format!("could not insert request log: {error}")
    }

    pub fn could_not_list_request_logs(error: impl std::fmt::Display) -> String {
        format!("could not list request logs: {error}")
    }

    pub fn could_not_map_request_log(error: impl std::fmt::Display) -> String {
        format!("could not map request log: {error}")
    }

    pub fn could_not_read_request_log(error: impl std::fmt::Display) -> String {
        format!("could not read request log: {error}")
    }

    pub fn log_uuid_invalid(error: impl std::fmt::Display) -> String {
        format!("generated request log UUID is invalid: {error}")
    }

    pub fn log_status_code_invalid(error: impl std::fmt::Display) -> String {
        format!("invalid log status code: {error}")
    }

    pub fn request_id_invalid(error: impl std::fmt::Display) -> String {
        format!("request ID is invalid: {error}")
    }

    pub fn could_not_read_require_api_key(error: impl std::fmt::Display) -> String {
        format!("could not read require_api_key setting: {error}")
    }

    pub fn could_not_update_require_api_key(error: impl std::fmt::Display) -> String {
        format!("could not update require_api_key: {error}")
    }

    pub fn could_not_read_favorite_models(error: impl std::fmt::Display) -> String {
        format!("could not read favorite models: {error}")
    }

    pub fn could_not_read_hidden_models(error: impl std::fmt::Display) -> String {
        format!("could not read hidden models: {error}")
    }

    pub fn could_not_read_provider_flags(error: impl std::fmt::Display) -> String {
        format!("could not read provider flags: {error}")
    }

    pub fn could_not_read_favorite_id(error: impl std::fmt::Display) -> String {
        format!("could not read a favorite id: {error}")
    }

    pub fn could_not_read_hidden_model_id(error: impl std::fmt::Display) -> String {
        format!("could not read a hidden model id: {error}")
    }

    pub fn could_not_read_provider_flag_key(error: impl std::fmt::Display) -> String {
        format!("could not read a provider flag key: {error}")
    }

    pub fn could_not_read_provider_connections(error: impl std::fmt::Display) -> String {
        format!("could not read provider connections: {error}")
    }

    pub fn could_not_read_provider_flag(error: impl std::fmt::Display) -> String {
        format!("could not read the provider flag: {error}")
    }

    pub fn could_not_start_provider_update(error: impl std::fmt::Display) -> String {
        format!("could not start the provider update: {error}")
    }

    pub fn could_not_commit_provider_update(error: impl std::fmt::Display) -> String {
        format!("could not commit the provider update: {error}")
    }

    pub fn could_not_store_provider_flag(error: impl std::fmt::Display) -> String {
        format!("could not store the provider flag: {error}")
    }

    pub fn could_not_hide_model(error: impl std::fmt::Display) -> String {
        format!("could not hide the model: {error}")
    }

    pub fn could_not_restore_model(error: impl std::fmt::Display) -> String {
        format!("could not restore the model: {error}")
    }

    pub fn could_not_drop_restored_row(error: impl std::fmt::Display) -> String {
        format!("could not drop the restored row: {error}")
    }

    pub fn could_not_favorite_model(error: impl std::fmt::Display) -> String {
        format!("could not favorite the model: {error}")
    }

    pub fn could_not_unfavorite_model(error: impl std::fmt::Display) -> String {
        format!("could not unfavorite the model: {error}")
    }

    /// Action labels fed to [`with_context`] at each statement site.
    pub mod context {
        // Admin auth store.
        pub const CREATE_ADMIN_SESSION: &str = "create an admin session";
        pub const CREATE_ADMIN_ACCOUNT: &str = "create the admin account";
        pub const DELETE_ADMIN_SESSION: &str = "delete an admin session";
        pub const READ_ADMIN_SESSION: &str = "read an admin session";
        pub const READ_ADMIN_ACCOUNT: &str = "read the admin account";
        pub const READ_ADMIN_PASSWORD_HASH: &str = "read the admin password hash";
        pub const UPDATE_ADMIN_PASSWORD_HASH: &str = "update the admin password hash";

        // API-key store.
        pub const ADD_CREDIT: &str = "add credit to an API key";
        pub const COMMIT_CREDIT_UPDATE: &str = "commit a credit update";
        pub const COMMIT_KEY_UPDATE: &str = "commit a key update";
        pub const CREATE_API_KEY: &str = "create an API key";
        pub const DELETE_API_KEY: &str = "delete an API key";
        pub const INCREMENT_API_KEY_USAGE: &str = "increment API-key usage";
        pub const LIST_API_KEYS: &str = "list API keys";
        pub const LOOK_UP_API_KEY: &str = "look up an API key";
        pub const READ_API_KEY: &str = "read an API key";
        pub const READ_REQUIRE_API_KEY: &str = "read the require_api_key setting";
        pub const RESERVE_API_KEY_QUOTA: &str = "reserve API-key quota";
        pub const SETTLE_API_KEY_QUOTA: &str = "settle API-key quota";
        pub const START_CREDIT_UPDATE: &str = "start a credit update";
        pub const START_KEY_UPDATE: &str = "start a key update";
        pub const UPDATE_API_KEY: &str = "update an API key";

        // Schema migration.
        pub const ADD_MISSING_COLUMN: &str = "add a column older databases are missing";
        pub const APPLY_REQUEST_LOG_V3: &str = "apply request-log v3 migration";
        pub const APPLY_CURRENT_SCHEMA: &str = "apply the current schema";
        pub const COMMIT_SCHEMA_MIGRATION: &str = "commit the schema migration";
        pub const DROP_LEGACY_TABLE: &str = "drop a legacy table";
        pub const INSPECT_TABLE_COLUMNS: &str = "inspect a table's columns";
        pub const LIST_TABLES: &str = "list the existing tables";
        pub const READ_LEGACY_REQUEST_LOGS: &str = "read legacy request logs";
        pub const READ_LEGACY_API_KEYS: &str = "read the legacy api_keys table";
        pub const READ_LEGACY_FALLBACK_RULES: &str = "read the legacy fallback_rules table";
        pub const READ_LEGACY_MODEL_OVERRIDES: &str = "read the legacy model override tables";
        pub const READ_LEGACY_PROVIDERS: &str = "read the legacy providers table";
        pub const READ_SCHEMA_VERSION: &str = "read the schema version";
        pub const RECORD_SCHEMA_VERSION: &str = "record the schema version";
        pub const RENAME_LEGACY_TABLE: &str = "rename a legacy table";
        pub const RESTORE_FALLBACK_RULE: &str = "restore a fallback rule row";
        pub const RESTORE_MODEL_OVERRIDE: &str = "restore a model override row";
        pub const RESTORE_API_KEY: &str = "restore an API key row";
        pub const RESTORE_PROVIDER: &str = "restore a provider row";
        pub const START_SCHEMA_MIGRATION: &str = "start the schema migration";
        pub const UPGRADE_LEGACY_REQUEST_LOG: &str = "upgrade a legacy request log";
    }
}

/// The outbound HTTP client.
pub mod upstream {
    pub fn could_not_build_client(error: impl std::fmt::Display) -> String {
        format!("could not build the HTTP client: {error}")
    }
}
