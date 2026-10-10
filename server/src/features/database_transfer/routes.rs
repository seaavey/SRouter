//! `/v1/admin/database/*` routes: export and import.
//!
//! Mounted inside the `/v1` nest only, matching `apps/api/src/index.ts:141`
//! (deliberately absent from the `/v1/v1` compat group).

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderValue, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::clock::now_ms;
use crate::error::APIError;
use crate::features::admin_auth::session::cleared_cookie;
use crate::state::AppState;

use super::multipart::stream_database_field;
use super::transfer::{
    MAX_UPLOAD_BYTES, TransferError, export_filename, export_snapshot, import_database,
};

/// Mounts the database transfer routes.
pub fn create_database_router() -> Router<AppState> {
    Router::new()
        .route("/admin/database/export", get(export_handler))
        .route("/admin/database/import", post(import_handler))
        // Route-level `Content-Length` guard, matching Node's router middleware
        // (`apps/api/src/routes/v1/database.ts:22-29`). Through the full app the
        // global `body_limit` layer runs first and answers `413`, exactly like
        // Node's listener; mounted alone the router answers `400`.
        .layer(axum::middleware::from_fn(content_length_guard))
        // The `Multipart` extractor applies `DefaultBodyLimit` to its own body
        // and the default is 2 MiB, so a legal 25 MiB upload would never reach
        // the stream loop. The cap is set above the documented 25 MiB upload
        // limit because multipart framing is overhead on top of the file; the
        // file itself is bounded while streaming in `stream_database_field`.
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES + 1024 * 1024))
}

async fn content_length_guard(request: Request<Body>, next: Next) -> Response {
    let oversized = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<usize>().ok())
        .is_some_and(|length| length > MAX_UPLOAD_BYTES);

    if oversized {
        return APIError::from(TransferError::UploadTooLarge).into_response();
    }

    next.run(request).await
}

/// `GET /v1/admin/database/export`.
async fn export_handler(State(state): State<AppState>) -> Result<Response, APIError> {
    let database = state
        .database
        .as_ref()
        .ok_or_else(|| APIError::from(TransferError::UnsupportedStorage))?;

    let directory = std::env::temp_dir().join(format!(
        "srouter-database-export-{}-{}",
        std::process::id(),
        now_ms()
    ));
    std::fs::create_dir_all(&directory).map_err(|error| {
        APIError::new(
            500,
            format!("could not create the export directory: {error}"),
        )
    })?;
    let output_path = directory.join("database.db");

    let result = export_snapshot(database, &state.config.srouter_dir, &output_path).await;
    let response = result.and_then(|()| export_response(&output_path));

    let _ = std::fs::remove_dir_all(&directory);
    response
}

fn export_response(output_path: &std::path::Path) -> Result<Response, APIError> {
    let bytes = std::fs::read(output_path).map_err(|error| {
        APIError::new(
            500,
            format!("could not read the database snapshot: {error}"),
        )
    })?;
    let length = bytes.len();

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&length.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"{}\"",
            export_filename(now_ms())
        ))
        .map_err(|error| {
            APIError::new(500, format!("could not build the export filename: {error}"))
        })?,
    );

    Ok(response)
}

/// `POST /v1/admin/database/import`.
async fn import_handler(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let database = state
        .database
        .as_ref()
        .ok_or_else(|| APIError::from(TransferError::UnsupportedStorage))?;

    let directory =
        state
            .config
            .srouter_dir
            .join(format!("transfer-temp-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&directory).map_err(|error| {
        APIError::new(
            500,
            format!("could not create the transfer directory: {error}"),
        )
    })?;
    set_private_dir_mode(&directory)?;
    let candidate_path = directory.join("database.db");

    let result = stream_database_field(request, &state, &candidate_path).await;
    let result = match result {
        Ok(()) => import_database(database, &state.config, &candidate_path).await,
        Err(error) => Err(error),
    };

    let _ = std::fs::remove_dir_all(&directory);

    let import = result?;
    let mut response = Json(json!({
        "ok": true,
        "backup_path": import.backup_path,
        "restart_required": import.restart_required,
        "reauth_required": import.reauth_required,
    }))
    .into_response();
    // The replacement invalidates the operator's session, so the cookie is
    // cleared and they re-authenticate.
    if let Ok(cookie) = cleared_cookie(state.config.secure_cookies) {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    Ok(response)
}

fn set_private_dir_mode(path: &std::path::Path) -> Result<(), APIError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|error| {
        APIError::new(
            500,
            format!("could not restrict the transfer directory permissions: {error}"),
        )
    })
}
