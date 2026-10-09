//! Writes the bindings into every path `bindings::targets` names.
//!
//! Run it with `cargo run --manifest-path server/Cargo.toml --bin export_ts`;
//! `server/tests/bindings.rs` fails when a regeneration differs from the
//! committed files, so a shape change that is not re-exported fails the suite.

use srouter_server::bindings;

fn main() {
    let document = bindings::export().unwrap_or_else(|error| panic!("could not render: {error}"));

    for target in bindings::targets() {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|error| panic!("could not create {}: {error}", parent.display()));
        }

        std::fs::write(&target, &document)
            .unwrap_or_else(|error| panic!("could not write {}: {error}", target.display()));

        println!("wrote {}", target.display());
    }
}
