//! Streams the single `database` file part of an import request to a private
//! candidate file, enforcing the 25 MiB cap while writing.
//!
//! Node hand-rolled a multipart boundary parser
//! (`database.controller.ts:98-190`) only because `Request.formData()`
//! buffers the whole body. axum's `Multipart` extractor streams, so the wire
//! behavior is preserved (one file part named `database`, a filename before or
//! after the name, duplicates rejected, 25 MiB enforced while streaming) and
//! the parser is not ported.

use std::io::Write;
use std::path::Path;

use axum::body::Body;
use axum::extract::FromRequest;
use axum::extract::multipart::Multipart;
use axum::http::Request;
use axum::http::header::CONTENT_TYPE;

use crate::error::APIError;

use super::transfer::{MAX_UPLOAD_BYTES, TransferError};

/// Streams the request's `database` field into `candidate_path`.
///
/// The field-shape rules are the controller's own (`partCount > 1`,
/// `name == "database" && no filename`), decided from `Field::name` and
/// `Field::file_name`, not by the multipart parser (the plan's D12).
pub async fn stream_database_field<S>(
    request: Request<Body>,
    state: &S,
    candidate_path: &Path,
) -> Result<(), APIError>
where
    S: Send + Sync,
{
    // Node answers `upload_too_large` when the request carries no body at all
    // (`database.controller.ts:230-232`), before it ever looks at multipart.
    let content_type = request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    if content_type.is_empty() {
        return Err(TransferError::UploadTooLarge.into());
    }

    let mut multipart = Multipart::from_request(request, state)
        .await
        .map_err(|_| TransferError::MissingDatabaseFile)?;

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate_path)
        .map_err(|error| {
            APIError::new(
                500,
                format!("could not create the transfer candidate file: {error}"),
            )
        })?;
    set_private_file_mode(candidate_path)?;

    let mut part_count = 0usize;
    let mut file_bytes = 0usize;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| TransferError::InvalidMultipart)?
    {
        part_count += 1;
        let is_database_field = field.name() == Some("database");
        let is_file_part = is_database_field && field.file_name().is_some();

        if part_count > 1 || (is_database_field && !is_file_part) {
            return Err(TransferError::InvalidDatabaseField.into());
        }
        if !is_file_part {
            continue;
        }

        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|_| TransferError::InvalidMultipart)?
        {
            file_bytes += chunk.len();
            if file_bytes > MAX_UPLOAD_BYTES {
                return Err(TransferError::UploadTooLarge.into());
            }
            file.write_all(&chunk).map_err(|error| {
                APIError::new(
                    500,
                    format!("could not write the transfer candidate file: {error}"),
                )
            })?;
        }
    }

    file.flush().map_err(|error| {
        APIError::new(
            500,
            format!("could not flush the transfer candidate file: {error}"),
        )
    })?;

    if part_count != 1 || file_bytes == 0 {
        return Err(TransferError::InvalidMultipart.into());
    }

    Ok(())
}

/// `chmod 0600`. The candidate holds operator data, so it must not be
/// world-readable while it sits on disk.
pub(super) fn set_private_file_mode(path: &Path) -> Result<(), APIError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
        APIError::new(
            500,
            format!("could not restrict the transfer file permissions: {error}"),
        )
    })
}
