use std::net::SocketAddr;

use axum::extract::ConnectInfo;
use axum::http::request::Parts;

/// Returns the socket peer address of the request, or `None` when the listener
/// is not serving connect info.
///
/// Proxy and client-identifying headers are deliberately never consulted. The
/// Node runtime falls back to the request URL hostname because Hono's
/// `getConnInfo` fails in its test harness; that fallback lets a remote client
/// claim `localhost` by setting `Host`, and the real Rust listener always has
/// connect info.
pub fn resolve_client_address(parts: &Parts) -> Option<String> {
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(address)| address.ip().to_string())
}

/// Matches Node's `isLoopbackAddress`: lowercase, strip one `::ffff:` prefix,
/// then require exactly `127.0.0.1` or `::1`.
pub fn is_loopback_address(address: &str) -> bool {
    let lowercased = address.to_lowercase();
    let normalized = lowercased
        .strip_prefix("::ffff:")
        .unwrap_or(lowercased.as_str());

    normalized == "127.0.0.1" || normalized == "::1"
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::body::Body;
    use axum::extract::ConnectInfo;
    use axum::http::Request;

    use super::{is_loopback_address, resolve_client_address};

    fn request_parts(
        headers: &[(&str, &str)],
        connect_info: Option<SocketAddr>,
    ) -> axum::http::request::Parts {
        let mut builder = Request::builder().uri("/v1/chat/completions");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }

        let mut request = builder.body(Body::empty()).expect("request");
        if let Some(address) = connect_info {
            request.extensions_mut().insert(ConnectInfo(address));
        }

        request.into_parts().0
    }

    #[test]
    fn loopback_addresses_are_exact() {
        assert!(is_loopback_address("127.0.0.1"));
        assert!(is_loopback_address("::1"));
        assert!(!is_loopback_address("127.0.0.2"));
        assert!(!is_loopback_address("203.0.113.7"));
        assert!(!is_loopback_address("localhost"));
        assert!(!is_loopback_address(""));
    }

    #[test]
    fn v4_mapped_loopback_is_normalized() {
        assert!(is_loopback_address("::FFFF:127.0.0.1"));
    }

    #[test]
    fn connect_info_supplies_the_client_address() {
        let parts = request_parts(&[], Some(SocketAddr::from(([203, 0, 113, 7], 5555))));

        assert_eq!(
            resolve_client_address(&parts).as_deref(),
            Some("203.0.113.7")
        );
    }

    #[test]
    fn header_only_requests_have_no_client_address() {
        let parts = request_parts(
            &[("host", "localhost"), ("x-forwarded-for", "127.0.0.1")],
            None,
        );

        assert_eq!(resolve_client_address(&parts), None);
    }

    #[test]
    fn connect_info_beats_request_headers() {
        let parts = request_parts(
            &[("host", "localhost")],
            Some(SocketAddr::from(([203, 0, 113, 7], 5555))),
        );

        assert_eq!(
            resolve_client_address(&parts).as_deref(),
            Some("203.0.113.7")
        );
    }
}
