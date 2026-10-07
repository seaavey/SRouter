//! Writes `server/bindings.ts`, the TypeScript view of the API wire shapes.
//!
//! Run it with `cargo run --manifest-path server/Cargo.toml --bin export_ts`;
//! `server/tests/bindings.rs` fails when a regeneration differs from the
//! committed file, so a shape change that is not re-exported fails the suite.

use std::path::PathBuf;

fn main() {
    let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bindings.ts");
    let bindings = srouter_server::bindings::export()
        .unwrap_or_else(|error| panic!("could not render: {error}"));

    std::fs::write(&target, bindings)
        .unwrap_or_else(|error| panic!("could not write {}: {error}", target.display()));

    println!("wrote {}", target.display());
}
