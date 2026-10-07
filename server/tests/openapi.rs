//! The published contract (`server/openapi.json`): determinism, drift against a
//! regeneration, and coverage of the routes `app.rs` actually mounts.
//!
//! The document is the input for `apps/web`'s generated types, so a stale file,
//! an undocumented route, or a schema that disagrees with the wire fails here.

mod support;

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, Uri};
use axum::response::Response;
use serde_json::Value;
use srouter_server::AppState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::{ADMIN_SESSION_COOKIE, hash_session_token};
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::openapi;
use support::TestDatabase;
use tower::ServiceExt;

/// `PROPFIND` is never routed, so the answer separates "the path is mounted"
/// (`405`, the method router rejected it) from "nobody serves it" (`404`, the
/// nest fallback answered).
const UNSUPPORTED_METHOD: &str = "PROPFIND";

/// The probes carry a valid admin session, so a guard never answers before the
/// method router: without it a guarded route would answer `401` to the
/// unsupported method instead of the `405` that proves the path is mounted.
const SESSION_TOKEN: &str = "openapi-probe-session";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

async fn app(database: &TestDatabase) -> Router {
    let security =
        support::sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().expect("default providers"),
        security,
    )
    .with_database(database.connect().await.expect("connect"));

    create_router(state)
}

async fn send(app: &Router, method: &str, uri: &str) -> Response {
    let request = Request::builder()
        .method(Method::from_bytes(method.to_uppercase().as_bytes()).expect("method"))
        .uri(Uri::try_from(uri).expect("uri"))
        .header("cookie", format!("{ADMIN_SESSION_COOKIE}={SESSION_TOKEN}"))
        .body(Body::empty())
        .expect("request");

    app.clone()
        .oneshot(support::with_loopback_client(request))
        .await
        .expect("the router answers every request")
}

/// Substitutes a probe value for every path parameter, so the document's
/// templates become the concrete paths the router sees.
fn concrete_path(template: &str) -> String {
    template
        .replace("{model}", "probe/model")
        .replace("{provider_id}", "probe-provider")
        .replace("{id}", "probe-id")
}

/// Every `(path, method)` the document claims, in a stable order.
fn documented_operations() -> Vec<(String, String)> {
    let document = openapi::document();
    let paths = document
        .get("paths")
        .and_then(Value::as_object)
        .expect("the document has paths");

    let mut operations = Vec::new();
    for (path, entry) in paths {
        for method in entry.as_object().expect("a path entry is an object").keys() {
            operations.push((path.clone(), method.clone()));
        }
    }
    operations.sort();
    operations
}

/// Resolves a `$ref` against `components.schemas`.
fn schema_of<'a>(document: &'a Value, reference: &str) -> &'a Value {
    let name = reference
        .strip_prefix("#/components/schemas/")
        .unwrap_or_else(|| panic!("unexpected reference `{reference}`"));

    document
        .pointer(&format!("/components/schemas/{name}"))
        .unwrap_or_else(|| panic!("`{name}` is a declared schema"))
}

#[test]
fn two_generations_are_byte_identical() {
    let first = openapi::document_json();
    let second = openapi::document_json();

    assert_eq!(first, second, "the document carries no run-dependent data");
    assert!(first.ends_with("}\n"), "the file ends with one newline");
    serde_json::from_str::<Value>(&first).expect("the rendered document parses");
}

#[test]
fn the_committed_document_matches_a_regeneration() {
    let committed =
        fs::read_to_string(manifest_dir().join("openapi.json")).expect("`server/openapi.json`");

    assert_eq!(
        committed,
        openapi::document_json(),
        "`server/openapi.json` is stale; regenerate it with \
         `cargo run --manifest-path server/Cargo.toml --bin export_openapi`"
    );
}

#[test]
fn the_document_declares_openapi_3_1_and_its_security_schemes() {
    let document = openapi::document();

    assert_eq!(document["openapi"], "3.1.0");
    assert_eq!(document["info"]["version"], env!("CARGO_PKG_VERSION"));

    let schemes = document["components"]["securitySchemes"]
        .as_object()
        .expect("security schemes");
    assert_eq!(
        schemes.keys().collect::<Vec<_>>(),
        ["adminSession", "bearerAuth", "srouterApiKey"],
        "the guard vocabulary is pinned"
    );

    for (path, method) in documented_operations() {
        let entry = document
            .pointer(&format!("/paths/{}/{}", escape(&path), method))
            .expect("the operation is in the document");

        assert!(
            entry.get("summary").is_some_and(Value::is_string),
            "{method} {path} carries a summary"
        );
        assert!(
            entry.get("security").is_some(),
            "{method} {path} states its guard"
        );
        assert!(
            entry.get("responses").is_some(),
            "{method} {path} documents its responses"
        );

        for requirement in entry["security"].as_array().expect("security list") {
            for name in requirement.as_object().expect("requirement").keys() {
                assert!(
                    schemes.contains_key(name),
                    "{method} {path} names the declared scheme `{name}`"
                );
            }
        }
    }
}

#[test]
fn the_document_excludes_the_routes_this_build_does_not_serve() {
    let paths = openapi::document()["paths"]
        .as_object()
        .expect("paths")
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();

    for excluded in ["/v1/tunnel", "/v1/settings/fallbacks"] {
        assert!(
            !paths.iter().any(|path| path.starts_with(excluded)),
            "`{excluded}` is a documented exclusion and must stay undocumented"
        );
    }

    let compat = paths
        .iter()
        .filter(|path| path.starts_with("/v1/v1/"))
        .cloned()
        .collect::<BTreeSet<_>>();
    assert_eq!(
        compat,
        BTreeSet::from([
            "/v1/v1/chat/completions".to_owned(),
            "/v1/v1/chat/completion".to_owned(),
            "/v1/v1/chat".to_owned(),
            "/v1/v1/messages".to_owned(),
            "/v1/v1/messages/count_tokens".to_owned(),
            "/v1/v1/images/generations".to_owned(),
            "/v1/v1/models".to_owned(),
            "/v1/v1/models/{model}".to_owned(),
        ]),
        "the compatibility alias covers the gateway and the two catalog reads"
    );
}

/// Every `.route("…")` literal under `server/src` must appear in the document,
/// so a route added without regenerating `openapi.json` fails here.
#[test]
fn every_route_literal_in_the_source_is_documented() {
    let document = openapi::document();
    let documented = document["paths"]
        .as_object()
        .expect("paths")
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    let mut literals = BTreeSet::new();
    for source in source_files(&manifest_dir().join("src")) {
        let text = fs::read_to_string(&source).expect("readable source");
        let mut rest = text.as_str();
        while let Some(found) = rest.find(".route(") {
            rest = &rest[found + ".route(".len()..];
            let trimmed = rest.trim_start();
            if !trimmed.starts_with('"') {
                continue;
            }
            let end = trimmed[1..]
                .find('"')
                .map(|index| index + 1)
                .expect("a closed route literal");
            literals.insert(trimmed[..=end].trim_matches('"').to_owned());
        }
    }

    assert!(!literals.is_empty(), "the scan found the route literals");

    for literal in literals {
        // A catch-all segment is spelled `{*model}` in axum and `{model}` in
        // OpenAPI, so the two spellings have to be reconciled before comparing.
        let normalized = literal.replace("{*", "{");
        assert!(
            documented
                .iter()
                .any(|path| *path == normalized || path.ends_with(&normalized)),
            "`{literal}` is routed but missing from `server/openapi.json`"
        );
    }
}

/// A documented operation must really be routable: the method is accepted, and
/// the path itself answers `405` for a method nobody registered (which an
/// unmounted path would not, it answers `404`).
#[tokio::test]
async fn every_documented_operation_is_mounted() {
    let database = TestDatabase::new().expect("temporary database");
    let app = app(&database).await;

    for (path, method) in documented_operations() {
        let uri = concrete_path(&path);
        let response = send(&app, &method, &uri).await;
        assert_ne!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method} {uri} is documented but not routed"
        );

        let unsupported = send(&app, UNSUPPORTED_METHOD, &uri).await;
        assert_eq!(
            unsupported.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{uri} is documented but no route serves it"
        );
    }
}

/// The schemas are derived from the Rust models, so a live response and its
/// documented schema must name the same fields.
#[tokio::test]
async fn the_documented_response_schemas_match_the_wire() {
    let database = TestDatabase::new().expect("temporary database");
    let app = app(&database).await;
    let document = openapi::document();

    // (route, operation, schema pointer of the object to compare)
    for (uri, schema_reference) in [
        ("/v1/admin/status", "#/components/schemas/AdminStatus"),
        ("/v1/settings", "#/components/schemas/SettingsResponse"),
        ("/v1/quota", "#/components/schemas/QuotaResponse"),
        ("/v1/providers", "#/components/schemas/ProviderListResponse"),
        (
            "/v1/providers/catalog",
            "#/components/schemas/CatalogResponse",
        ),
        ("/v1/keys", "#/components/schemas/KeyListResponse"),
        ("/v1/models", "#/components/schemas/ModelListResponse"),
        ("/v1/logs", "#/components/schemas/LogsResponse"),
        ("/v1/logs/stats", "#/components/schemas/UsageStatsReport"),
        ("/v1/logs/analytics", "#/components/schemas/AnalyticsReport"),
    ] {
        let response = send(&app, "GET", uri).await;
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("body");
        let body: Value = serde_json::from_slice(&bytes).expect("JSON body");
        assert_eq!(
            status,
            StatusCode::OK,
            "{uri} answers without credentials from loopback: {}",
            String::from_utf8_lossy(&bytes)
        );

        assert_object_keys_match(&document, schema_reference, &body, uri);
    }

    // The provider list nests one entry per driver: compare the first entry
    // against the schema it is documented with.
    let response = send(&app, "GET", "/v1/providers").await;
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("body"),
    )
    .expect("JSON body");
    let entry = body["data"]
        .as_array()
        .and_then(|entries| entries.first())
        .expect("the seed list is not empty");
    assert_object_keys_match(
        &document,
        "#/components/schemas/ProviderEntry",
        entry,
        "/v1/providers data[0]",
    );
}

/// Fails when the wire carries a field the schema does not declare.
fn assert_object_keys_match(document: &Value, reference: &str, body: &Value, where_: &str) {
    let schema = schema_of(document, reference);
    let declared = schema["properties"]
        .as_object()
        .unwrap_or_else(|| panic!("{reference} declares properties"))
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();

    let actual = body
        .as_object()
        .unwrap_or_else(|| panic!("{where_} answers an object"))
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();

    let undocumented = actual.difference(&declared).collect::<Vec<_>>();
    assert!(
        undocumented.is_empty(),
        "{where_} returns fields {reference} does not declare: {undocumented:?}"
    );
}

/// Every `.rs` file under `server/src`.
fn source_files(root: &PathBuf) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = fs::read_dir(root).expect("readable source directory");

    for entry in entries {
        let path = entry.expect("directory entry").path();
        if path.is_dir() {
            files.extend(source_files(&path));
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }

    files.sort();
    files
}

/// Percent-encodes a path so it can be used as a JSON pointer segment.
fn escape(path: &str) -> String {
    path.replace('~', "~0").replace('/', "~1")
}
