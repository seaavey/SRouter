//! Cookie header parsing shared by the session middleware. Node joins duplicate
//! `Cookie` headers with `"; "` and passes quoted values through unchanged, so
//! both behaviors are kept; session tokens are base64url and need no
//! percent-decoding.

use axum::http::{HeaderMap, header};

pub(crate) fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookies = headers
        .get_all(header::COOKIE)
        .iter()
        .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned())
        .collect::<Vec<String>>()
        .join("; ");

    if cookies.is_empty() {
        return None;
    }

    cookies.split(';').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;

        (key.trim() == name).then(|| value.trim().to_owned())
    })
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderName, HeaderValue, header};

    use super::cookie_value;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                HeaderValue::from_str(value).expect("header value"),
            );
        }

        map
    }

    #[test]
    fn the_admin_session_cookie_is_read_by_name() {
        let map = headers(&[("cookie", "a=1; srouter_admin_session=token; b=2")]);

        assert_eq!(
            cookie_value(&map, "srouter_admin_session").as_deref(),
            Some("token")
        );
    }

    #[test]
    fn a_missing_cookie_reads_as_none() {
        assert_eq!(
            cookie_value(&headers(&[("cookie", "a=1")]), "srouter_admin_session"),
            None
        );
        assert_eq!(cookie_value(&headers(&[]), "srouter_admin_session"), None);
    }

    #[test]
    fn duplicate_cookie_headers_are_joined() {
        let mut map = HeaderMap::new();
        map.append(header::COOKIE, HeaderValue::from_static("a=1"));
        map.append(
            header::COOKIE,
            HeaderValue::from_static("srouter_admin_session=token"),
        );

        assert_eq!(
            cookie_value(&map, "srouter_admin_session").as_deref(),
            Some("token")
        );
    }

    #[test]
    fn quoted_cookie_values_are_not_unwrapped() {
        // The Node cookie parser keeps the quotes, so the hashed value stays
        // wrong for a quoted token and Rust must reject it the same way.
        let map = headers(&[("cookie", "srouter_admin_session=\"token\"")]);

        assert_eq!(
            cookie_value(&map, "srouter_admin_session").as_deref(),
            Some("\"token\"")
        );
    }
}
