mod support;

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use serde_json::json;
use srouter_server::app::create_router;
use srouter_server::features::providers::adapter::{OpenAIAdapter, ProviderAdapter};
use srouter_server::features::providers::model::ModelDefinition;
use srouter_server::infrastructure::upstream::UpstreamClient;
use srouter_server::{AppState, SecurityState};
use support::{
    FakeUpstream, FixtureAPIKeyStore, FixtureAdminSessionStore, TestDatabase, api_key_record,
    test_config, with_loopback_client,
};
use tower::ServiceExt;

const MOCK_PROVIDER_ID: &str = "mock-image-prov";
const MOCK_MODEL_ID: &str = "gpt-image-1.5";

async fn setup_app_with_image_provider() -> (FakeUpstream, Router, AppState) {
    let upstream = FakeUpstream::start().await;
    let mut providers = srouter_server::features::providers::ProviderRegistry::new();

    let client = UpstreamClient::new().expect("upstream client");
    let image_adapter = OpenAIAdapter::new(
        MOCK_PROVIDER_ID,
        &[MOCK_PROVIDER_ID],
        upstream.base_url(),
        &[ModelDefinition {
            id: MOCK_MODEL_ID,
            name: "GPT Image 1.5",
        }],
        client,
    );
    providers.register(ProviderAdapter::new(image_adapter));

    let state = AppState::with_security(test_config(), providers, SecurityState::unconfigured());

    let router = create_router(state.clone());
    (upstream, router, state)
}

fn image_request(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
}

fn raw_image_request(uri: &str, body: String) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn post_images_generations_succeeds_with_valid_image_model() {
    let (upstream, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "A beautiful mountain",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["created"], 1725408000);
    assert_eq!(
        body["data"][0]["url"],
        "https://example.com/mock-generated.png"
    );
    assert_eq!(
        body["data"][0]["revised_prompt"],
        "Revised: A beautiful mountain"
    );

    assert_eq!(upstream.image_requests(), 1);
    assert_eq!(upstream.last_image_body()["prompt"], "A beautiful mountain");
    assert_eq!(upstream.last_image_body()["model"], MOCK_MODEL_ID);
}

#[tokio::test]
async fn post_images_generations_compat_alias_succeeds() {
    let (upstream, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/v1/images/generations",
            json!({
                "prompt": "A serene lake",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["created"], 1725408000);
    assert_eq!(upstream.image_requests(), 1);
}

#[tokio::test]
async fn post_images_generations_rejects_unsupported_text_models_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "Draw a mountain",
                "model": "deepseek/deepseek-chat"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    let message = body["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("does not support image generation"),
        "expected error message to contain image capability check, got: {message}"
    );
    assert_eq!(body["error"]["code"], "model_not_supported");
    assert_eq!(body["error"]["param"], "model");
    assert_eq!(body["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_images_generations_rejects_unsupported_gpt4o_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "Invalid prompt",
                "model": "openai/gpt-4o"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    let message = body["error"]["message"].as_str().unwrap();
    assert!(message.contains("does not support image generation"));
    assert_eq!(body["error"]["code"], "model_not_supported");
}

#[tokio::test]
async fn post_images_generations_rejects_missing_prompt_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_payload");
    assert_eq!(body["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_images_generations_rejects_empty_prompt_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "   ",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_payload");
}

#[tokio::test]
async fn post_images_generations_rejects_malformed_json_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(raw_image_request(
            "/v1/images/generations",
            "{ not valid json".to_owned(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_json");
    assert_eq!(body["error"]["message"], "Malformed JSON in request body");
}

#[tokio::test]
async fn post_images_generations_enforces_model_allowlist() {
    let upstream = FakeUpstream::start().await;
    let mut providers = srouter_server::features::providers::ProviderRegistry::new();
    let client = UpstreamClient::new().expect("upstream client");
    let image_adapter = OpenAIAdapter::new(
        MOCK_PROVIDER_ID,
        &[MOCK_PROVIDER_ID],
        upstream.base_url(),
        &[ModelDefinition {
            id: MOCK_MODEL_ID,
            name: "GPT Image 1.5",
        }],
        client,
    );
    providers.register(ProviderAdapter::new(image_adapter));

    // Create key that only allows another model
    let mut key_record = api_key_record("key-restricted");
    key_record.allowed_models = Some(vec!["other-model".to_owned()]);
    let security = SecurityState::new(
        Arc::new(FixtureAPIKeyStore::new(
            false,
            vec![("sr-live-key-restricted".to_owned(), key_record)],
        )),
        Arc::new(FixtureAdminSessionStore::new(vec![])),
    );

    let state = AppState::with_security(test_config(), providers, security);
    let app = create_router(state);

    let request = Request::builder()
        .method("POST")
        .uri("/v1/images/generations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, "Bearer sr-live-key-restricted")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "prompt": "Allowed check",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }))
            .unwrap(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "model_not_allowed");
    assert_eq!(body["error"]["type"], "permission_error");
}

#[tokio::test]
async fn post_images_generations_rejects_unsupported_image_editing_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "Edit this mountain",
                "model": "dall-e-3",
                "image": "data:image/png;base64,..."
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    let message = body["error"]["message"].as_str().unwrap();
    assert_eq!(
        message,
        "Model 'dall-e-3' does not support image editing / image-to-image input."
    );
    assert_eq!(body["error"]["code"], "model_not_supported");
}

#[tokio::test]
async fn post_images_generations_rejects_n_out_of_bounds_with_400() {
    let (_, app, _) = setup_app_with_image_provider().await;

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "Generate 20 mountains",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}"),
                "n": 20
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_payload");
}

#[tokio::test]
async fn post_images_generations_writes_request_log() {
    let test_db = TestDatabase::new().unwrap();
    let database = test_db.connect().await.unwrap();

    let upstream = FakeUpstream::start().await;
    let mut providers = srouter_server::features::providers::ProviderRegistry::new();
    let client = UpstreamClient::new().expect("upstream client");
    let image_adapter = OpenAIAdapter::new(
        MOCK_PROVIDER_ID,
        &[MOCK_PROVIDER_ID],
        upstream.base_url(),
        &[ModelDefinition {
            id: MOCK_MODEL_ID,
            name: "GPT Image 1.5",
        }],
        client,
    );
    providers.register(ProviderAdapter::new(image_adapter));

    let state = AppState::with_security(
        test_db.config().unwrap(),
        providers,
        SecurityState::unconfigured(),
    )
    .with_database(database.clone());

    let app = create_router(state);

    let response = app
        .oneshot(image_request(
            "/v1/images/generations",
            json!({
                "prompt": "Logging mountain",
                "model": format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}")
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Query request_logs
    let row: (i64, String, i64, i64, i64) = sqlx::query_as(
        "SELECT status_code, model, prompt_tokens, completion_tokens, total_tokens FROM request_logs LIMIT 1",
    )
    .fetch_one(&database.sqlite_pool().unwrap())
    .await
    .unwrap();

    assert_eq!(row.0, 200);
    assert_eq!(row.1, format!("{MOCK_PROVIDER_ID}/{MOCK_MODEL_ID}"));
    assert_eq!(row.2, 0); // prompt_tokens
    assert_eq!(row.3, 0); // completion_tokens
    assert_eq!(row.4, 0); // total_tokens
}
