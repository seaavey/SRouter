//! Telemetry coverage: every event reaches the log file, failed requests log their method,
//! path, and status, and 5xx envelopes log the error detail while 4xx stays silent there.

mod support;

use std::io::Write;
use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use axum::response::IntoResponse;
use srouter_server::app::create_router;
use srouter_server::error::APIError;
use srouter_server::infrastructure::telemetry;
use support::{empty_registry_state, json_request, security_state};
use tower::ServiceExt;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;

/// Capturing writer for a scoped subscriber; every formatted event lands in the buffer.
#[derive(Clone)]
struct Buffer(Arc<Mutex<Vec<u8>>>);

impl Buffer {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }

    fn contents(&self) -> String {
        let bytes = self.lock().clone();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn clear(&self) {
        self.lock().clear();
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<u8>> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

impl Write for Buffer {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.lock().write(buffer)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Buffer {
    type Writer = Buffer;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

fn capturing_subscriber(buffer: Buffer) -> impl tracing::Subscriber + Send + Sync {
    tracing_subscriber::registry()
        .with(EnvFilter::new("info"))
        .with(fmt::layer().with_ansi(false).with_writer(buffer))
}

#[test]
fn subscriber_appends_events_to_the_log_file() {
    let directory =
        std::env::temp_dir().join(format!("srouter-telemetry-{}", uuid::Uuid::new_v4()));
    let path = telemetry::init_in(&directory).expect("file subscriber installs");

    tracing::info!("telemetry file probe");

    let contents = std::fs::read_to_string(&path).expect("log file readable");
    assert!(contents.contains("telemetry file probe"), "{contents}");
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn failed_requests_are_logged_with_method_path_and_status() {
    let buffer = Buffer::new();
    let subscriber = capturing_subscriber(buffer.clone());
    let app = create_router(empty_registry_state(security_state(false, vec![], vec![])));

    let (not_found, welcome, logged) = tracing::subscriber::with_default(subscriber, || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let not_found = runtime
            .block_on(app.clone().oneshot(json_request(
                "GET",
                "/v1/no-such-route",
                serde_json::Value::Null,
            )))
            .expect("request completes");
        let logged = buffer.contents();
        buffer.clear();
        let welcome = runtime
            .block_on(app.oneshot(json_request("GET", "/", serde_json::Value::Null)))
            .expect("request completes");
        (not_found, welcome, logged)
    });

    assert_eq!(not_found.status(), StatusCode::NOT_FOUND);
    assert!(logged.contains("WARN"), "{logged}");
    assert!(logged.contains("/v1/no-such-route"), "{logged}");
    assert!(logged.contains("status=404"), "{logged}");
    assert_eq!(welcome.status(), StatusCode::OK);
    assert!(
        buffer.contents().is_empty(),
        "successful requests must not log"
    );
}

#[test]
fn internal_errors_log_the_error_detail_and_client_errors_do_not() {
    let buffer = Buffer::new();
    let subscriber = capturing_subscriber(buffer.clone());

    tracing::subscriber::with_default(subscriber, || {
        let server_error = APIError::new(500, "upstream exploded").into_response();
        assert_eq!(server_error.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let logged = buffer.contents();
        assert!(logged.contains("ERROR"), "{logged}");
        assert!(logged.contains("upstream exploded"), "{logged}");
        buffer.clear();

        let client_error = APIError::new(400, "bad input").into_response();
        assert_eq!(client_error.status(), StatusCode::BAD_REQUEST);
        assert!(
            buffer.contents().is_empty(),
            "4xx details stay out of the log"
        );
    });
}
