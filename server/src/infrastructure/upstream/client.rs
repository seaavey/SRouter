use std::time::Duration;

use reqwest::Client;

use crate::error::APIError;

/// Upper bound for a non-streaming upstream request. Streams are not given a
/// total timeout, so this is applied per request rather than on the client.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Upper bound for establishing the upstream connection.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum silence tolerated on a streaming upstream response before the
/// gateway closes the stream with an in-stream error event.
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// Shared HTTP transport for provider adapters.
#[derive(Clone)]
pub struct UpstreamClient {
    client: Client,
}

impl UpstreamClient {
    pub fn new() -> Result<Self, APIError> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(concat!("srouter-server/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| {
                APIError::new(500, format!("could not build the HTTP client: {error}"))
            })?;

        Ok(Self { client })
    }

    /// The underlying reqwest client.
    pub fn raw(&self) -> &Client {
        &self.client
    }

    /// Timeout applied to non-streaming requests.
    pub fn request_timeout(&self) -> Duration {
        REQUEST_TIMEOUT
    }
}
