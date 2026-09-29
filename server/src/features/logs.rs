//! API-key-protected request-log endpoints and live events.

use std::convert::Infallible;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderValue, Version, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::stream;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use crate::error::APIError;
use crate::infrastructure::database::request_logs::{
    RequestLog, get_request_log, list_request_logs, subscribe_request_logs, usage_stats,
};
use crate::state::AppState;

const MAX_EVENT_STREAMS: usize = 16;
static ACTIVE_EVENT_STREAMS: AtomicUsize = AtomicUsize::new(0);

pub fn create_logs_router() -> Router<AppState> {
    Router::new()
        .route("/logs", get(list_logs))
        .route("/logs/events", get(log_events))
        .route("/logs/{id}", get(get_log))
}

#[derive(Deserialize)]
struct LogsQuery {
    page: Option<String>,
    limit: Option<String>,
    status: Option<String>,
}

#[derive(Serialize)]
struct LogsResponse {
    object: &'static str,
    data: Vec<RequestLog>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pagination: Option<Pagination>,
}

#[derive(Serialize)]
struct Pagination {
    page: i64,
    limit: i64,
    total: i64,
    total_pages: i64,
}

async fn list_logs(
    State(state): State<AppState>,
    Query(query): Query<LogsQuery>,
) -> Result<Json<LogsResponse>, APIError> {
    let database = state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, "request log database is not configured"))?;
    let page = query
        .page
        .as_deref()
        .and_then(|page| page.parse::<i64>().ok())
        .filter(|page| *page != 0)
        .unwrap_or(1);
    let limit = query
        .limit
        .as_deref()
        .and_then(|limit| limit.parse::<i64>().ok())
        .filter(|limit| *limit != 0)
        .unwrap_or(50);
    let paginated = query.page.is_some();
    let page = list_request_logs(
        database,
        paginated.then_some(page),
        limit,
        paginated.then_some(query.status.as_deref()).flatten(),
    )
    .await?;
    let pagination = paginated.then(|| Pagination {
        page: page.page,
        limit: page.limit,
        total: page.total,
        total_pages: if page.total == 0 {
            0
        } else {
            1 + (page.total - 1) / page.limit
        },
    });
    Ok(Json(LogsResponse {
        object: "list",
        data: page.data,
        pagination,
    }))
}

async fn get_log(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Result<Json<RequestLog>, APIError> {
    let id = Uuid::parse_str(&raw_id)
        .map_err(|_| APIError::new(404, format!("Log '{raw_id}' not found")))?;
    let database = state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, "request log database is not configured"))?;
    get_request_log(database, id)
        .await?
        .map(Json)
        .ok_or_else(|| APIError::new(404, format!("Log '{raw_id}' not found")))
}

struct EventStreamSlot;

impl EventStreamSlot {
    fn acquire() -> Result<Self, APIError> {
        ACTIVE_EVENT_STREAMS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < MAX_EVENT_STREAMS).then_some(active + 1)
            })
            .map(|_| Self)
            .map_err(|_| APIError::new(429, "Too many usage event streams"))
    }
}

impl Drop for EventStreamSlot {
    fn drop(&mut self) {
        ACTIVE_EVENT_STREAMS.fetch_sub(1, Ordering::AcqRel);
    }
}

async fn log_events(State(state): State<AppState>, request: Request) -> Result<Response, APIError> {
    let database = state
        .database
        .clone()
        .ok_or_else(|| APIError::new(500, "request log database is not configured"))?;
    let slot = EventStreamSlot::acquire()?;
    let receiver = subscribe_request_logs();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
    heartbeat.tick().await;
    let stream = stream::unfold(
        (true, receiver, database, slot, heartbeat),
        |(connected, mut receiver, database, slot, mut heartbeat)| async move {
            let event = if connected {
                Some(connected_event())
            } else {
                loop {
                    let event = tokio::select! {
                        _ = heartbeat.tick() => Some(Ok(Bytes::from_static(b": ping\n\n"))),
                        result = receiver.recv() => match result {
                            Ok(id) => live_events(&database, Some(id)).await,
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                live_events(&database, None).await
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
                        }
                    };
                    if event.is_some() {
                        break event;
                    }
                }
            };
            event.map(|event| (event, (false, receiver, database, slot, heartbeat)))
        },
    );
    let mut response = Body::from_stream(stream).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    if matches!(request.version(), Version::HTTP_10 | Version::HTTP_11) {
        response
            .headers_mut()
            .insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    }
    response
        .headers_mut()
        .insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}

fn connected_event() -> Result<Bytes, Infallible> {
    Ok(Bytes::from_static(b"data: {\"type\":\"connected\"}\n\n"))
}

async fn live_events(
    database: &crate::infrastructure::database::AppDatabase,
    log_id: Option<Uuid>,
) -> Option<Result<Bytes, Infallible>> {
    let result = async {
        let stats = usage_stats(database).await?;
        let log = match log_id {
            Some(id) => get_request_log(database, id).await?,
            None => list_request_logs(database, None, 1, None)
                .await?
                .data
                .into_iter()
                .next(),
        };
        if log_id.is_some() && log.is_none() {
            return Ok(None);
        }
        let mut event = format!(
            "data: {}\n\n",
            serde_json::json!({
                "type": "usage.updated",
                "stats": stats
            })
        );
        if let Some(log) = log {
            event.push_str(&format!(
                "data: {}\n\n",
                serde_json::json!({
                    "type": "request.logged",
                    "log": log
                })
            ));
        }
        Ok::<_, APIError>(Some(Bytes::from(event)))
    }
    .await;
    match result {
        Ok(Some(event)) => Some(Ok(event)),
        Ok(None) | Err(_) => None,
    }
}
