//! Writes `server/openapi.json` from the document in [`srouter_server::openapi`].
//!
//! Run it with `cargo run --manifest-path server/Cargo.toml --bin export_openapi`;
//! `server/tests/openapi.rs` compares the committed file with a regeneration, so
//! a route or model change that is not re-exported fails the suite.

use std::path::PathBuf;

fn main() {
    let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("openapi.json");
    let document = srouter_server::openapi::document_json();

    std::fs::write(&target, document)
        .unwrap_or_else(|error| panic!("could not write {}: {error}", target.display()));

    println!("wrote {}", target.display());
}
