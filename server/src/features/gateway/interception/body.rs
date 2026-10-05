//! Request-body reading and classification shared by the chat, messages, and
//! image routes.

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::header;
use serde_json::Value;

use crate::constants;
use crate::error::{APIError, invalid_json};
use crate::request::MAX_BODY_BYTES;

/// How the request body failed before any handler logic ran. Each route maps
/// this onto its own error envelope.
#[derive(Debug)]
pub(crate) enum BodyError {
    TooLarge,
    Empty,
    Malformed,
}

/// Reads a JSON request body, classifying the three failures the contract
/// distinguishes. The size cap also covers a chunked body that lies about its
/// length; `MAX_BODY_BYTES` is shared with the global body-limit middleware.
pub(crate) async fn read_json_body(request: Request) -> Result<Value, BodyError> {
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        && length > MAX_BODY_BYTES
    {
        return Err(BodyError::TooLarge);
    }

    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES as usize)
        .await
        .map_err(|_| BodyError::TooLarge)?;

    let text = std::str::from_utf8(&bytes).map_err(|_| BodyError::Malformed)?;
    if text.trim().is_empty() {
        return Err(BodyError::Empty);
    }

    serde_json::from_str(text).map_err(|_| BodyError::Malformed)
}

/// Maps a body failure onto the OpenAI envelope used by the chat routes.
pub(crate) fn body_error_to_api_error(error: BodyError) -> APIError {
    match error {
        BodyError::TooLarge => APIError::new(413, constants::json::TOO_LARGE)
            .with_code(constants::code::REQUEST_TOO_LARGE),
        BodyError::Empty => {
            APIError::new(400, constants::json::EMPTY_BODY).with_code(constants::code::INVALID_JSON)
        }
        BodyError::Malformed => invalid_json(),
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::extract::Request;
    use axum::http::header;

    use crate::constants;
    use crate::error::invalid_json;
    use crate::request::MAX_BODY_BYTES;

    use super::{BodyError, body_error_to_api_error, read_json_body};

    fn body_request(body: Body) -> Request {
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .body(body)
            .expect("request builds")
    }

    #[tokio::test]
    async fn a_content_length_over_the_cap_is_rejected_before_reading_the_body() {
        let request = Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .header(header::CONTENT_LENGTH, (MAX_BODY_BYTES + 1).to_string())
            .body(Body::from("{}"))
            .expect("request builds");

        let error = read_json_body(request)
            .await
            .expect_err("header exceeds the cap");
        assert!(matches!(error, BodyError::TooLarge));
    }

    #[tokio::test]
    async fn a_body_over_the_cap_is_rejected_even_without_a_content_length() {
        let oversize = Body::from(vec![b' '; MAX_BODY_BYTES as usize + 1]);

        let error = read_json_body(body_request(oversize))
            .await
            .expect_err("body exceeds the cap");
        assert!(matches!(error, BodyError::TooLarge));
    }

    #[tokio::test]
    async fn blank_bodies_are_rejected_as_empty() {
        for raw in ["", "  \n\t"] {
            let error = read_json_body(body_request(Body::from(raw)))
                .await
                .expect_err("blank body");
            assert!(matches!(error, BodyError::Empty), "for {raw:?}");
        }
    }

    #[tokio::test]
    async fn invalid_utf8_and_invalid_json_are_rejected_as_malformed() {
        let error = read_json_body(body_request(Body::from(vec![0xff, 0xfe])))
            .await
            .expect_err("invalid utf8");
        assert!(matches!(error, BodyError::Malformed));

        let error = read_json_body(body_request(Body::from("{not json")))
            .await
            .expect_err("invalid json");
        assert!(matches!(error, BodyError::Malformed));
    }

    #[tokio::test]
    async fn a_valid_json_body_parses_to_its_value() {
        let value = read_json_body(body_request(Body::from(r#"{"model":"mimo"}"#)))
            .await
            .expect("valid json parses");

        assert_eq!(value["model"], "mimo");
    }

    #[test]
    fn body_failures_map_to_their_frozen_envelopes() {
        let too_large = body_error_to_api_error(BodyError::TooLarge);
        assert_eq!(too_large.status(), 413);
        assert_eq!(too_large.message(), constants::json::TOO_LARGE);
        assert_eq!(
            too_large.to_envelope().error.code.as_deref(),
            Some(constants::code::REQUEST_TOO_LARGE)
        );

        let empty = body_error_to_api_error(BodyError::Empty);
        assert_eq!(empty.status(), 400);
        assert_eq!(empty.message(), constants::json::EMPTY_BODY);
        assert_eq!(
            empty.to_envelope().error.code.as_deref(),
            Some(constants::code::INVALID_JSON)
        );

        assert_eq!(
            body_error_to_api_error(BodyError::Malformed),
            invalid_json()
        );
    }
}
