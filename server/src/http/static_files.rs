//! Static dashboard serving with an SPA fallback, mirroring the Node API's
//! `resolveWebDistPath()` (`apps/api/src/services/webDist.ts`) and the mount
//! block in `apps/api/src/index.ts:148-170`.
//!
//! When a dist with `index.html` resolves, `GET /` and the SPA routes serve
//! `index.html`, real files under the dist are served with their content type,
//! and asset extensions get an immutable cache header. Without a dist the API
//! keeps serving its info object at `/`.
//!
//! Deviation from Node: unmatched `/v1/*` paths stay JSON `404` because the
//! `/v1` nest owns its fallback; Node's global `GET *` catch-all would serve
//! `index.html` there too.

use std::path::{Component, Path, PathBuf};

use axum::Extension;
use axum::extract::Request;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::config::APIConfig;

/// Cache-Control value for fingerprinted assets, matching the Node rule.
pub const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Extensions the Node mount gives the immutable cache header. The regex is
/// `(?:js|css|map|woff2?|ttf|otf|png|svg|ico|webp|avif|jpe?g|gif)$`.
const IMMUTABLE_EXTENSIONS: &[&str] = &[
    "js", "css", "map", "woff", "woff2", "ttf", "otf", "png", "svg", "ico", "webp", "avif", "jpg",
    "jpeg", "gif",
];

/// Resolves the web dist directory when it actually holds an `index.html`.
/// `WEB_DIST_PATH` wins; otherwise the same candidate search as Node runs from
/// the current working directory.
pub fn resolve_web_dist(config: &APIConfig) -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;

    if let Some(configured) = config.web_dist_path.as_ref() {
        let dist = if configured.is_absolute() {
            configured.clone()
        } else {
            cwd.join(configured)
        };

        return dist.join("index.html").is_file().then_some(dist);
    }

    dashboard_dist_candidates(&cwd)
        .into_iter()
        .find(|dist| dist.join("index.html").is_file())
}

/// Serves a dist file or the SPA fallback. Non-GET/HEAD methods are `404`.
pub async fn serve_static(Extension(dist): Extension<PathBuf>, request: Request) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }

    let head_only = request.method() == Method::HEAD;
    let relative = percent_decode(request.uri().path().trim_start_matches('/'));

    if let Some(requested) = safe_join(&dist, &relative)
        && requested.is_file()
    {
        let immutable = has_immutable_extension(&relative);
        return file_response(&requested, immutable, head_only).await;
    }

    // SPA fallback: unmatched GETs render the dashboard shell.
    file_response(&dist.join("index.html"), false, head_only).await
}

/// Reads and serves one file. A file that disappears between the check and the
/// read reports `404` rather than a `500`.
async fn file_response(path: &Path, immutable: bool, head_only: bool) -> Response {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mut response = if head_only {
        StatusCode::OK.into_response()
    } else {
        (StatusCode::OK, bytes).into_response()
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(path)),
    );
    if immutable {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(IMMUTABLE_CACHE_CONTROL),
        );
    }

    response
}

/// Whether a path carries an extension that gets the immutable cache header.
fn has_immutable_extension(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            IMMUTABLE_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

/// A small built-in content-type map; unknown extensions fall back to binary.
fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Joins a decoded request path onto the dist root, rejecting every component
/// that could escape it (`..`, absolute roots, prefixes).
fn safe_join(dist: &Path, relative: &str) -> Option<PathBuf> {
    let mut path = dist.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    Some(path)
}

/// Percent-decodes a path; invalid escapes pass through unchanged.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                match std::str::from_utf8(&bytes[index + 1..index + 3])
                    .ok()
                    .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                {
                    Some(byte) => {
                        decoded.push(byte);
                        index += 3;
                    }
                    None => {
                        decoded.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

/// The directory that holds the monorepo markers, else `cwd` itself.
fn find_repo_root(cwd: &Path) -> PathBuf {
    let mut current = cwd.to_path_buf();

    loop {
        if current.join("pnpm-workspace.yaml").exists() || current.join("turbo.json").exists() {
            return current;
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return cwd.to_path_buf(),
        }
    }
}

/// The dist candidates Node searches, in order.
fn dashboard_dist_candidates(cwd: &Path) -> Vec<PathBuf> {
    let repo_root = find_repo_root(cwd);
    let mut candidates = vec![
        repo_root.join("apps/web/dist"),
        cwd.join("../web/dist"),
        cwd.join("apps/web/dist"),
        cwd.join("dist"),
    ];

    let mut current = cwd.to_path_buf();
    loop {
        candidates.push(current.join("apps/web/dist"));
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }

    candidates
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{has_immutable_extension, safe_join};

    #[test]
    fn asset_extensions_match_the_node_regex() {
        for path in [
            "assets/app.js",
            "assets/app.css",
            "x.map",
            "f.woff2",
            "f.woff",
            "i.png",
            "i.svg",
            "i.ico",
            "i.webp",
            "i.avif",
            "i.jpg",
            "i.jpeg",
            "i.gif",
        ] {
            assert!(has_immutable_extension(path), "{path}");
        }

        for path in ["index.html", "route", "data.json", "app.js.map.txt"] {
            assert!(!has_immutable_extension(path), "{path}");
        }
    }

    #[test]
    fn traversal_components_are_rejected() {
        let dist = Path::new("/srv/dist");

        assert_eq!(
            safe_join(dist, "assets/app.js"),
            Some(dist.join("assets/app.js"))
        );
        assert_eq!(safe_join(dist, "../secret"), None);
        assert_eq!(safe_join(dist, "assets/../../etc/passwd"), None);
    }
}
