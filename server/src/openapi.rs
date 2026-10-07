//! The OpenAPI 3.1 description of every route this build serves.
//!
//! `server/openapi.json` is generated from this module by
//! `cargo run --manifest-path server/Cargo.toml --bin export_openapi`. The file
//! is committed, and `server/tests/openapi.rs` fails when a regeneration
//! differs from it, when a documented path is not mounted, or when a `.route`
//! literal in `server/src` is missing from the document.
//!
//! Two rules shape the document:
//!
//! - **Provenance.** Response schemas are derived from the Rust models with
//!   `schemars`, and the schemas a handler builds inline are written here next
//!   to the path that answers them. Nothing under `packages/*` is read, and no
//!   Node-only route is documented: the table mirrors `create_router` in
//!   `app.rs`, including the `/v1/v1` alias and the deliberate absence of
//!   `/v1/tunnel/*` and `/v1/settings/fallbacks/*`.
//! - **Determinism.** The document is plain `serde_json`, so every map keeps one
//!   fixed ordering, no timestamps or absolute paths are embedded, and the only
//!   version source is `CARGO_PKG_VERSION`.

use schemars::JsonSchema;
use serde_json::{Map, Value, json};

use crate::app::{ApiInfo, HealthResponse};
use crate::error::ErrorEnvelope;
use crate::features::admin_auth::ADMIN_SESSION_COOKIE;
use crate::features::admin_auth::routes::AdminStatus;
use crate::features::api_keys::routes::{APIKeyResponse, CreatedAPIKeyResponse, KeyListResponse};
use crate::features::api_keys::{CreateAPIKeyInput, UpdateAPIKeyInput};
use crate::features::catalog::models::{CatalogModel, ModelListResponse};
use crate::features::catalog::quota::QuotaResponse;
use crate::features::catalog::{ModelPricingItem, PricingListResponse};
use crate::features::logs::{LiveEvent, LogsResponse};
use crate::features::providers::management::model::{CatalogResponse, ProviderEntry};
use crate::features::providers::management::routes::ProviderListResponse;
use crate::features::settings::SettingsResponse;
use crate::infrastructure::database::request_logs::{
    AnalyticsReport, RequestLog, UsageStatsReport,
};

/// The gateway and catalog routes the `/v1/v1` nest repeats, with the one
/// method that nest mounts for each (`app.rs`; the model writes are `/v1` only).
const COMPAT_ROUTES: &[(&str, &str)] = &[
    ("/v1/chat/completions", "post"),
    ("/v1/chat/completion", "post"),
    ("/v1/chat", "post"),
    ("/v1/messages", "post"),
    ("/v1/messages/count_tokens", "post"),
    ("/v1/images/generations", "post"),
    ("/v1/models", "get"),
    ("/v1/models/{model}", "get"),
];

/// Renders the document. Byte-for-byte identical across runs: the export bin
/// writes this string, and the drift test compares it with the committed file.
pub fn document_json() -> String {
    let mut rendered =
        serde_json::to_string_pretty(&document()).expect("the OpenAPI document serializes to JSON");
    rendered.push('\n');
    rendered
}

/// The document itself: info, paths, and components (security schemes plus one
/// schema per Rust model the routes answer with).
pub fn document() -> Value {
    json!({
        "openapi": "3.1.0",
        "info": info(),
        "paths": paths(),
        "components": components(),
    })
}

fn info() -> Value {
    json!({
        "title": "SRouter API",
        "version": env!("CARGO_PKG_VERSION"),
        "description": concat!(
            "Multi-provider OpenAI and Anthropic compatible LLM gateway, as served by the ",
            "Rust build (`server/`). One listener on `PORT` carries the API, the dashboard ",
            "SPA, and the provider callbacks; there is no secondary OAuth listener. Every ",
            "response uses snake_case field names (owner ruling 2026-10-07), and errors use ",
            "the `{error:{message,type,code?,param?}}` envelope. Cloudflare Tunnel routes and ",
            "`/v1/settings/fallbacks/*` are excluded from this build by owner ruling; they do ",
            "not appear below and answer `404`."
        ),
    })
}

/// Which guard a route carries, stated the way `docs/api-v1-contract.md` states
/// it: "API-key auth" accepts a key **or** an admin session, and a request from
/// loopback may omit the key while API keys are not required.
#[derive(Clone, Copy)]
enum Auth {
    /// No guard: reachable without credentials.
    Public,
    /// `ApiKeyAuth`.
    ApiKey,
    /// The admin session cookie.
    Admin,
}

impl Auth {
    fn security(self) -> Value {
        match self {
            Auth::Public => json!([]),
            Auth::ApiKey => json!([
                {"srouterApiKey": []},
                {"bearerAuth": []},
                {"adminSession": []}
            ]),
            Auth::Admin => json!([{"adminSession": []}]),
        }
    }
}

fn schema_ref(name: &str) -> Value {
    json!({"$ref": format!("#/components/schemas/{name}")})
}

/// A response carrying one JSON object.
fn json_body(description: &str, schema: Value) -> Value {
    json!({
        "description": description,
        "content": {"application/json": {"schema": schema}}
    })
}

/// A response that carries no body.
fn no_body(description: &str) -> Value {
    json!({"description": description})
}

/// An `application/octet-stream` download (the database export).
fn octet_stream(description: &str) -> Value {
    json!({
        "description": description,
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}
    })
}

/// A server-sent event stream: each `data:` frame carries one payload.
fn event_stream(description: &str, schema: Value) -> Value {
    json!({
        "description": description,
        "content": {"text/event-stream": {"schema": schema}}
    })
}

/// A response whose body is an HTML page rendered for the browser.
fn html_body(description: &str) -> Value {
    json!({
        "description": description,
        "content": {"text/html": {"schema": {"type": "string"}}}
    })
}

/// Pairs each status with its response and appends the shared error envelope as
/// the catch-all, so every documented status class has one description.
fn responses(entries: &[(&str, Value)]) -> Value {
    let mut map = Map::new();
    for (status, response) in entries {
        map.insert((*status).to_owned(), response.clone());
    }
    map.insert(
        "default".to_owned(),
        json!({
            "description": "Error envelope; `error.type` follows the status class.",
            "content": {"application/json": {"schema": schema_ref("ErrorEnvelope")}}
        }),
    );
    Value::Object(map)
}

/// One operation: summary, the guard it carries, and its responses.
fn operation(summary: &str, auth: Auth, responses: Value) -> Value {
    json!({
        "summary": summary,
        "security": auth.security(),
        "responses": responses,
    })
}

/// Adds query or path parameters to an operation that was built by
/// [`operation`].
fn with_parameters(mut operation: Value, parameters: Value) -> Value {
    if let Value::Object(object) = &mut operation {
        object.insert("parameters".to_owned(), parameters);
    }
    operation
}

/// One path parameter. OpenAPI has no catch-all segment, so a model id's `/` is
/// described on the parameter instead of in the path template.
fn path_parameter(name: &str, description: &str) -> Value {
    json!({
        "name": name,
        "in": "path",
        "required": true,
        "description": description,
        "schema": {"type": "string"}
    })
}

/// One optional query parameter.
fn query_parameter(name: &str, description: &str, schema: Value) -> Value {
    json!({
        "name": name,
        "in": "query",
        "required": false,
        "description": description,
        "schema": schema
    })
}

fn route(paths: &mut Map<String, Value>, path: &str, method: &str, operation: Value) {
    let entry = paths
        .entry(path.to_owned())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(object) = entry {
        object.insert(method.to_owned(), operation);
    }
}

/// Every route `app.rs` mounts, in path order (maps serialize sorted).
fn paths() -> Map<String, Value> {
    let mut paths = Map::new();
    let boolean_flag = json!({"type": "boolean"});
    let flag_query = || {
        json!([
            query_parameter(
                "refresh",
                "Force a refresh of the cached catalog before answering.",
                json!({"type": "string"})
            ),
            query_parameter(
                "force",
                "Force a refresh of the cached catalog before answering.",
                json!({"type": "string"})
            )
        ])
    };

    // Root and health.
    route(
        &mut paths,
        "/",
        "get",
        operation(
            "Serve the dashboard or the API info object",
            Auth::Public,
            json!({
                "200": {
                    "description": "The API info object, or the SPA shell when a web dist is configured.",
                    "content": {
                        "application/json": {"schema": schema_ref("ApiInfo")},
                        "text/html": {"schema": {"type": "string"}}
                    }
                }
            }),
        ),
    );
    route(
        &mut paths,
        "/health",
        "get",
        operation(
            "Liveness probe",
            Auth::Public,
            json!({"200": json_body("Service is up.", schema_ref("HealthResponse"))}),
        ),
    );
    route(
        &mut paths,
        "/v1",
        "get",
        operation(
            "API info",
            Auth::Public,
            json!({"200": json_body("Name, status, version, and documentation.", schema_ref("ApiInfo"))}),
        ),
    );

    // The browser-facing OAuth callback pages, mounted at the application root
    // because the vendors accept only their own redirect paths.
    for path in [
        "/auth/callback",
        "/auth/openai/callback",
        "/auth/qoder/callback",
        "/auth/antigravity/callback",
        "/auth/claude/callback",
    ] {
        route(
            &mut paths,
            path,
            "get",
            operation(
                "Finish an OAuth flow in the browser",
                Auth::Public,
                json!({"200": html_body("HTML result page for the finished flow.")}),
            ),
        );
        route(
            &mut paths,
            path,
            "post",
            operation(
                "Finish an OAuth flow in the browser",
                Auth::Public,
                json!({"200": html_body("HTML result page for the finished flow.")}),
            ),
        );
    }

    // Gateway: chat, messages, images. API-key auth, the rate limiter, and the
    // model allowlist all apply here.
    let gateway_description = "API-key auth, the rate limiter, and the model allowlist apply.";
    let streaming_json = json!({
        "200": {
            "description": "A completion, or an SSE stream of completion chunks ending in `[DONE]`.",
            "content": {
                "application/json": {"schema": {"type": "object", "additionalProperties": true}},
                "text/event-stream": {"schema": {"type": "string"}}
            }
        }
    });
    for (path, summary) in [
        ("/v1/chat/completions", "Create a chat completion"),
        ("/v1/chat/completion", "Create a chat completion"),
        ("/v1/chat", "Create a chat completion"),
    ] {
        route(
            &mut paths,
            path,
            "post",
            json!({
                "summary": summary,
                "description": gateway_description,
                "security": Auth::ApiKey.security(),
                "responses": responses(&[("200", streaming_json.clone())]),
                "requestBody": {
                    "required": true,
                    "content": {"application/json": {"schema": {
                        "type": "object",
                        "description": "OpenAI chat-completion JSON; `developer` messages normalize to `system`.",
                        "additionalProperties": true
                    }}}
                }
            }),
        );
    }
    route(
        &mut paths,
        "/v1/messages",
        "post",
        json!({
            "summary": "Create an Anthropic message",
            "description": gateway_description,
            "security": Auth::ApiKey.security(),
            "responses": responses(&[("200", json!({
                "description": "An Anthropic message, or an SSE stream of Anthropic events.",
                "content": {
                    "application/json": {"schema": {"type": "object", "additionalProperties": true}},
                    "text/event-stream": {"schema": {"type": "string"}}
                }
            }))]),
            "requestBody": {
                "required": true,
                "content": {"application/json": {"schema": {
                    "type": "object",
                    "description": "Anthropic Messages JSON (`model`, `messages`, `max_tokens`, optional `stream`).",
                    "additionalProperties": true
                }}}
            }
        }),
    );
    route(
        &mut paths,
        "/v1/messages/count_tokens",
        "post",
        json!({
            "summary": "Count the tokens of a message batch",
            "description": gateway_description,
            "security": Auth::ApiKey.security(),
            "responses": responses(&[("200", json_body(
                "The token count.",json!({"type": "object", "additionalProperties": true})
            ))]),
            "requestBody": {
                "required": true,
                "content": {"application/json": {"schema": {"type": "object", "additionalProperties": true}}}
            }
        }),
    );
    route(
        &mut paths,
        "/v1/images/generations",
        "post",
        json!({
            "summary": "Generate images",
            "description": format!("{gateway_description} An unsupported image model answers `400`."),
            "security": Auth::ApiKey.security(),
            "responses": responses(&[("200", json_body(
                "Provider image output.",json!({"type": "object", "additionalProperties": true})
            ))]),
            "requestBody": {
                "required": true,
                "content": {"application/json": {"schema": {
                    "type": "object",
                    "required": ["prompt", "model"],
                    "properties": {
                        "prompt": {"type": "string"},
                        "model": {"type": "string"},
                        "n": {"type": "integer", "minimum": 1, "maximum": 10}
                    }
                }}
            }
        }}),
    );

    // Model catalog reads (API-key auth, never rate limited).
    route(
        &mut paths,
        "/v1/models",
        "get",
        with_parameters(
            operation(
                "List the model catalog",
                Auth::ApiKey,
                json!({"200": json_body(
                    "The allowlist-filtered catalog; hidden models and the models of disabled providers are dropped.",
                    schema_ref("ModelListResponse")
                )}),
            ),
            flag_query(),
        ),
    );
    route(
        &mut paths,
        "/v1/models/{model}",
        "get",
        with_parameters(
            operation(
                "Read one model",
                Auth::ApiKey,
                json!({"200": json_body("One catalog entry.", schema_ref("CatalogModel"))}),
            ),
            json!([path_parameter(
                "model",
                "Percent-encoded model id; the catch-all segment accepts an id that contains `/`."
            )]),
        ),
    );

    // Model writes: admin session, every model-level operation under /v1/models.
    let model_flags_body = json!({
        "required": false,
        "content": {"application/json": {"schema": {
            "type": "object",
            "properties": {"favorite": boolean_flag.clone(), "hidden": boolean_flag.clone()}
        }}}
    });
    route(
        &mut paths,
        "/v1/models",
        "post",
        operation(
            "Register a custom model",
            Auth::Admin,
            json!({
                "200": json_body("The model was already registered; the entry is returned.", schema_ref("CatalogModel")),
                "201": json_body("The model was registered.", schema_ref("CatalogModel"))
            }),
        ),
    );
    route(
        &mut paths,
        "/v1/models/{model}",
        "put",
        with_parameters(
            operation(
                "Upsert a custom model",
                Auth::Admin,
                json!({"200": json_body("The stored entry.", schema_ref("CatalogModel"))}),
            ),
            json!([path_parameter("model", "Percent-encoded model id.")]),
        ),
    );
    route(
        &mut paths,
        "/v1/models/{model}",
        "patch",
        with_parameters(
            operation(
                "Set the favorite or hidden flag",
                Auth::Admin,
                json!({"200": json_body("The entry with its new flags.", schema_ref("CatalogModel"))}),
            ),
            json!([path_parameter("model", "Percent-encoded model id.")]),
        ),
    );
    route(
        &mut paths,
        "/v1/models/{model}",
        "delete",
        with_parameters(
            operation(
                "Remove a custom model",
                Auth::Admin,
                json!({"200": json_body(
                    "The custom model was removed; a model that was not custom answers `404`.",json!({"type": "object", "required": ["deleted"], "properties": {"deleted": {"type": "boolean"}}})
                )}),
            ),
            json!([path_parameter("model", "Percent-encoded model id.")]),
        ),
    );
    // The two write bodies (declared after the operations that carry them).
    if let Some(object) = paths.get_mut("/v1/models").and_then(Value::as_object_mut)
        && let Some(post) = object.get_mut("post").and_then(Value::as_object_mut)
    {
        post.insert(
            "requestBody".to_owned(),
            json!({
                "required": true,
                "content": {"application/json": {"schema": {
                    "type": "object",
                    "required": ["model_id"],
                    "properties": {
                        "model_id": {"type": "string"},
                        "favorite": boolean_flag.clone(),
                        "hidden": boolean_flag.clone()
                    }
                }}}
            }),
        );
    }
    for method in ["put", "patch"] {
        if let Some(object) = paths
            .get_mut("/v1/models/{model}")
            .and_then(Value::as_object_mut)
            && let Some(operation) = object.get_mut(method).and_then(Value::as_object_mut)
        {
            operation.insert("requestBody".to_owned(), model_flags_body.clone());
        }
    }

    // API key management.
    route(
        &mut paths,
        "/v1/keys",
        "get",
        operation(
            "List API keys",
            Auth::Admin,
            json!({"200": json_body("Every key's management view; the secret is never returned.", schema_ref("KeyListResponse"))}),
        ),
    );
    route(
        &mut paths,
        "/v1/keys",
        "post",
        operation(
            "Create an API key",
            Auth::Admin,
            json!({"201": json_body("The created key plus its one-time secret.", schema_ref("CreatedAPIKeyResponse"))}),
        ),
    );
    route(
        &mut paths,
        "/v1/keys/{id}",
        "patch",
        with_parameters(
            operation(
                "Update an API key",
                Auth::Admin,
                json!({"200": json_body("The updated key.", schema_ref("APIKeyResponse"))}),
            ),
            json!([path_parameter("id", "Key id.")]),
        ),
    );
    route(
        &mut paths,
        "/v1/keys/{id}",
        "delete",
        with_parameters(
            operation(
                "Revoke an API key",
                Auth::Admin,
                json!({"200": json_body(
                    "The key was deleted; an unknown id answers `404`.",json!({"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}}})
                )}),
            ),
            json!([path_parameter("id", "Key id.")]),
        ),
    );
    route(
        &mut paths,
        "/v1/keys/{id}/credit",
        "post",
        with_parameters(
            operation(
                "Add credit to an API key",
                Auth::Admin,
                json!({"200": json_body("The updated key.", schema_ref("APIKeyResponse"))}),
            ),
            json!([path_parameter("id", "Key id.")]),
        ),
    );

    // Admin auth.
    route(
        &mut paths,
        "/v1/admin/status",
        "get",
        operation(
            "Report setup and session state",
            Auth::Public,
            json!({"200": json_body("Whether the install needs its first admin and whether the caller is authenticated.", schema_ref("AdminStatus"))}),
        ),
    );
    route(
        &mut paths,
        "/v1/admin/setup",
        "post",
        operation(
            "Create the first admin account (loopback only)",
            Auth::Public,
            json!({"201": json_body(
                "The account was created and the session cookie was set.",json!({"type": "object", "required": ["authenticated"], "properties": {"authenticated": {"type": "boolean"}}})
            )}),
        ),
    );
    route(
        &mut paths,
        "/v1/admin/login",
        "post",
        operation(
            "Open an admin session",
            Auth::Public,
            json!({"200": json_body(
                "The password was accepted and the session cookie was set; five failures per address answer `429` for 15 minutes.",json!({"type": "object", "required": ["authenticated"], "properties": {"authenticated": {"type": "boolean"}}})
            )}),
        ),
    );
    route(
        &mut paths,
        "/v1/admin/change-password",
        "post",
        operation(
            "Change the admin password",
            Auth::Admin,
            json!({"200": json_body(
                "The password was updated.",json!({"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}}})
            )}),
        ),
    );
    route(
        &mut paths,
        "/v1/admin/logout",
        "post",
        operation(
            "Close the admin session",
            Auth::Admin,
            json!({"204": no_body("The session was revoked and its cookie cleared.")}),
        ),
    );

    // Database transfer.
    route(
        &mut paths,
        "/v1/admin/database/export",
        "get",
        operation(
            "Export the database",
            Auth::Admin,
            json!({"200": octet_stream("A snapshot with a fourteen-digit UTC attachment filename.")}),
        ),
    );
    route(
        &mut paths,
        "/v1/admin/database/import",
        "post",
        operation(
            "Import a database snapshot",
            Auth::Admin,
            json!({"200": json_body(
                "The database was validated and replaced; the admin cookie is cleared.",
                schema_ref("DatabaseImportResponse")
            )}),
        ),
    );

    // Provider reads and the one provider write.
    route(
        &mut paths,
        "/v1/providers",
        "get",
        operation(
            "List the providers this build serves",
            Auth::ApiKey,
            json!({"200": json_body("One entry per built-in driver.", schema_ref("ProviderListResponse"))}),
        ),
    );
    route(
        &mut paths,
        "/v1/providers/catalog",
        "get",
        operation(
            "Read the provider catalog grouped by category",
            Auth::ApiKey,
            json!({"200": json_body("The four fixed groups.", schema_ref("CatalogResponse"))}),
        ),
    );
    route(
        &mut paths,
        "/v1/providers/{provider_id}",
        "get",
        with_parameters(
            operation(
                "Read one provider",
                Auth::ApiKey,
                json!({"200": json_body("The provider detail entry, with its connections.", schema_ref("ProviderEntry"))}),
            ),
            json!([path_parameter(
                "provider_id",
                "Provider id, for example `qoder`."
            )]),
        ),
    );
    route(
        &mut paths,
        "/v1/providers/{provider_id}",
        "patch",
        with_parameters(
            operation(
                "Toggle a provider or its model flags",
                Auth::Admin,
                json!({"200": json_body("The detail entry read back after the write.", schema_ref("ProviderEntry"))}),
            ),
            json!([path_parameter(
                "provider_id",
                "Provider id, for example `qoder`."
            )]),
        ),
    );
    route(
        &mut paths,
        "/v1/providers/{provider_id}/round-robin",
        "patch",
        with_parameters(
            operation(
                "Turn account rotation on or off",
                Auth::Admin,
                json!({"200": json_body("The detail entry read back after the write.", schema_ref("ProviderEntry"))}),
            ),
            json!([path_parameter(
                "provider_id",
                "Provider id, for example `qoder`."
            )]),
        ),
    );

    // Request logs.
    route(
        &mut paths,
        "/v1/logs",
        "get",
        with_parameters(
            operation(
                "List request logs",
                Auth::ApiKey,
                json!({"200": json_body(
                    "Recent logs when only `limit` is sent; a paginated page with totals when `page` is present.",
                    schema_ref("LogsResponse")
                )}),
            ),
            json!([
                query_parameter(
                    "page",
                    "Page number; sending it switches the reply to the paginated shape.",
                    json!({"type": "integer"})
                ),
                query_parameter(
                    "limit",
                    "Page size; defaults to 50.",
                    json!({"type": "integer"})
                ),
                query_parameter(
                    "status",
                    "`all`, `success`, or `error` (paginated listing only).",
                    json!({"type": "string", "enum": ["all", "success", "error"]})
                )
            ]),
        ),
    );
    route(
        &mut paths,
        "/v1/logs/{id}",
        "get",
        with_parameters(
            operation(
                "Read one request log",
                Auth::ApiKey,
                json!({"200": json_body("The log row; an unknown id answers `404`.", schema_ref("RequestLog"))}),
            ),
            json!([path_parameter("id", "Log id.")]),
        ),
    );
    route(
        &mut paths,
        "/v1/logs/stats",
        "get",
        operation(
            "Read the usage totals",
            Auth::ApiKey,
            json!({"200": json_body(
                "All-time totals in the shape the `usage.updated` event carries; `cost_label` uses four decimals.",
                schema_ref("UsageStatsReport")
            )}),
        ),
    );
    route(
        &mut paths,
        "/v1/logs/analytics",
        "get",
        with_parameters(
            operation(
                "Read the windowed analytics report",
                Auth::ApiKey,
                json!({"200": json_body(
                    "Zero-filled buckets, p95 latency, rolling RPS, and the top models, agents, and providers.",
                    schema_ref("AnalyticsReport")
                )}),
            ),
            json!([query_parameter(
                "window",
                "Bucket window; an unknown value answers `400`.",
                json!({"type": "string", "enum": ["1h", "24h", "7d", "30d"]})
            )]),
        ),
    );
    route(
        &mut paths,
        "/v1/logs/events",
        "get",
        operation(
            "Stream log and usage events",
            Auth::ApiKey,
            json!({"200": event_stream(
                "`connected`, `usage.updated`, and `request.logged` frames with a 25 s heartbeat; more than 16 streams answer `429`.",
                schema_ref("LiveEvent")
            )}),
        ),
    );

    // Quota.
    for path in ["/v1/quota", "/v1/qouta"] {
        route(
            &mut paths,
            path,
            "get",
            with_parameters(
                operation(
                    "Read provider OAuth quota",
                    Auth::ApiKey,
                    json!({"200": json_body(
                        "OAuth quota for the connected providers; non-OAuth providers are filtered out.",
                        schema_ref("QuotaResponse")
                    )}),
                ),
                flag_query(),
            ),
        );
    }

    // Pricing catalog.
    route(
        &mut paths,
        "/v1/pricing/models",
        "get",
        with_parameters(
            operation(
                "Read the models.dev pricing catalog",
                Auth::ApiKey,
                json!({"200": json_body(
                    "The models.dev catalog with per-model cost and limit metadata.",
                    schema_ref("PricingListResponse")
                )}),
            ),
            flag_query(),
        ),
    );

    // Settings.
    route(
        &mut paths,
        "/v1/settings",
        "get",
        operation(
            "Read the settings",
            Auth::ApiKey,
            json!({"200": json_body("The settings this build echoes.", schema_ref("SettingsResponse"))}),
        ),
    );
    for method in ["post", "patch"] {
        route(
            &mut paths,
            "/v1/settings",
            method,
            operation(
                "Update the settings",
                Auth::Admin,
                json!({"200": json_body(
                    "The settings this build echoes; a `settings` map is persisted without being echoed.",
                    schema_ref("SettingsResponse")
                )}),
            ),
        );
    }

    // Provider auth: device and OAuth login/poll/token/callback flows.
    route(
        &mut paths,
        "/v1/auth/cline/device",
        "get",
        operation(
            "Start the Cline device flow",
            Auth::Admin,
            json!({"200": json_body("The device authorization to open in a browser.", schema_ref("DeviceResponse"))}),
        ),
    );
    for method in ["get", "post"] {
        route(
            &mut paths,
            "/v1/auth/cline/poll",
            method,
            operation(
                "Poll the Cline device flow",
                Auth::Admin,
                json!({"200": json_body(
                    "The flow result: pending, denied, connected, or unknown state.",json!({"type": "object", "additionalProperties": true})
                )}),
            ),
        );
    }
    for provider in ["openai", "antigravity", "claude", "qoder"] {
        route(
            &mut paths,
            &format!("/v1/auth/{provider}/login"),
            "get",
            operation(
                "Start an authorization-code flow",
                Auth::Admin,
                json!({
                    "200": json_body("With `format=json`: the browser URL and the PKCE material the callback echoes.", schema_ref("LoginResponse")),
                    "302": no_body("Without `format=json`: a redirect to the authorization URL.")
                }),
            ),
        );
        for method in ["get", "post"] {
            route(
                &mut paths,
                &format!("/v1/auth/{provider}/callback"),
                method,
                operation(
                    "Finish an authorization-code flow",
                    Auth::Public,
                    json!({"200": json_body(
                        "The connected provider; missing `code` or `state` answers `400`, an unknown state `500`.",
                        schema_ref("CallbackResponse")
                    )}),
                ),
            );
        }
    }
    for provider in ["openai", "antigravity", "claude"] {
        route(
            &mut paths,
            &format!("/v1/auth/{provider}/token"),
            "post",
            operation(
                "Import tokens for a provider",
                Auth::Admin,
                json!({"201": json_body("The imported connection.", schema_ref("CallbackResponse"))}),
            ),
        );
    }
    for method in ["get", "post"] {
        route(
            &mut paths,
            "/v1/auth/qoder/poll",
            method,
            operation(
                "Poll the Qoder device flow",
                Auth::Admin,
                json!({"200": json_body("The flow result.",json!({"type": "object", "additionalProperties": true}))}),
            ),
        );
    }
    for provider in ["codebuddy", "codebuddy-cn"] {
        route(
            &mut paths,
            &format!("/v1/auth/{provider}/login"),
            "get",
            operation(
                "Start the CodeBuddy device flow",
                Auth::Admin,
                json!({
                    "200": json_body(
                        "With `format=json`: the authorization URL.",
                        schema_ref("CodeBuddyLoginResponse")
                    ),
                    "302": no_body("Without `format=json`: a redirect to the authorization URL.")
                }),
            ),
        );
        for method in ["get", "post"] {
            route(
                &mut paths,
                &format!("/v1/auth/{provider}/poll"),
                method,
                operation(
                    "Poll the CodeBuddy device flow",
                    Auth::Admin,
                    json!({"200": json_body("The flow result.",json!({"type": "object", "additionalProperties": true}))}),
                ),
            );
        }
    }
    route(
        &mut paths,
        "/v1/auth/grok-web/connect",
        "post",
        operation(
            "Connect a Grok Web session from a cookie",
            Auth::Admin,
            json!({"200": json_body(
                "The connection was stored and its catalog refreshed.",json!({"type": "object", "additionalProperties": true})
            )}),
        ),
    );

    // The `/v1/v1` compatibility alias repeats the gateway and the two catalog
    // reads with the same handlers and guards.
    for (path, method) in COMPAT_ROUTES {
        let source = paths
            .get(*path)
            .and_then(|entry| entry.get(*method))
            .cloned()
            .unwrap_or_else(|| panic!("`{path}` `{method}` is documented above"));
        route(&mut paths, &format!("/v1/v1{}", &path[3..]), method, source);
    }

    paths
}

/// Components: the security schemes plus one schema per Rust model.
fn components() -> Value {
    json!({
        "securitySchemes": {
            "srouterApiKey": {
                "type": "apiKey",
                "in": "header",
                "name": "x-api-key",
                "description": "An SRouter API key. `Authorization: Bearer <key>` carries the same credential."
            },
            "bearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "description": "The same API key in the `Authorization` header."
            },
            "adminSession": {
                "type": "apiKey",
                "in": "cookie",
                "name": ADMIN_SESSION_COOKIE,
                "description": "The admin session cookie. It also satisfies API-key auth on the routes that accept it."
            }
        },
        "schemas": schemas()
    })
}

/// Collects one component per Rust model: the named type itself plus whatever
/// it references, which `schemars` parks under `$defs`.
fn model<T: JsonSchema>() -> Map<String, Value> {
    let rendered = serde_json::to_value(schemars::schema_for!(T))
        .expect("a generated schema serializes to JSON");
    let mut root = rendered
        .as_object()
        .cloned()
        .expect("a struct or enum schema is a JSON object");
    root.remove("$schema");
    let definitions = root
        .remove("$defs")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    let mut root = Value::Object(root);
    relocate_definitions(&mut root);

    let mut models = definitions;
    for schema in models.values_mut() {
        relocate_definitions(schema);
    }
    models.insert(T::schema_name().into_owned(), root);
    models
}

/// Rewrites `#/$defs/...` to `#/components/schemas/...`: `schemars` nests the
/// types it pulls in under `$defs`, and this document keeps them in
/// `components`, so every reference has to follow them there.
fn relocate_definitions(value: &mut Value) {
    match value {
        Value::String(reference) => {
            if let Some(name) = reference.strip_prefix("#/$defs/") {
                *reference = format!("#/components/schemas/{name}");
            }
        }
        Value::Array(items) => items.iter_mut().for_each(relocate_definitions),
        Value::Object(object) => object.values_mut().for_each(relocate_definitions),
        _ => {}
    }
}

/// Every schema the routes answer with. The two hand-written entries describe
/// bodies a handler builds inline instead of returning a named model.
fn schemas() -> Map<String, Value> {
    let mut schemas = Map::new();

    for model in [
        model::<ApiInfo>(),
        model::<HealthResponse>(),
        model::<ErrorEnvelope>(),
        model::<AdminStatus>(),
        model::<KeyListResponse>(),
        model::<APIKeyResponse>(),
        model::<CreatedAPIKeyResponse>(),
        model::<CreateAPIKeyInput>(),
        model::<UpdateAPIKeyInput>(),
        model::<ModelListResponse>(),
        model::<CatalogModel>(),
        model::<PricingListResponse>(),
        model::<ModelPricingItem>(),
        model::<LogsResponse>(),
        model::<RequestLog>(),
        model::<UsageStatsReport>(),
        model::<AnalyticsReport>(),
        model::<SettingsResponse>(),
        model::<ProviderListResponse>(),
        model::<ProviderEntry>(),
        model::<CatalogResponse>(),
        model::<QuotaResponse>(),
        model::<LiveEvent>(),
        model::<crate::features::provider_auth::DeviceResponse>(),
        model::<crate::features::provider_auth::LoginResponse>(),
        model::<crate::features::provider_auth::CodeBuddyLoginResponse>(),
        model::<crate::features::provider_auth::CallbackResponse>(),
    ] {
        schemas.extend(model);
    }

    // `POST /v1/admin/database/import` answers with an inline object
    // (`features/database_transfer/routes.rs`), so its schema is written here.
    schemas.insert(
        "DatabaseImportResponse".to_owned(),
        json!({
            "type": "object",
            "required": ["ok", "backup_path", "restart_required", "reauth_required"],
            "properties": {
                "ok": {"type": "boolean"},
                "backup_path": {"type": "string"},
                "restart_required": {"type": "boolean"},
                "reauth_required": {"type": "boolean"}
            }
        }),
    );

    schemas
}
