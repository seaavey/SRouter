# Contributing to SRouter

The repository is one Rust crate, `server/`, plus the LICENSE. `cargo` is the whole build system; there is no workspace and no Node toolchain.

## Build and run

Install a stable toolchain with rustup. `server/rust-toolchain.toml` pins the version, and cargo picks it up when you build inside the crate.

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
cargo run --manifest-path server/Cargo.toml
```

The server listens on port 3000 and keeps its SQLite database at `~/.srouter/srouter.db`. `server/.env.example` lists every variable it reads, and `PORT` and `DATABASE_PATH` are the two you are most likely to change. A configured `DATABASE_URL` is refused on purpose: SQLite is the only backend. The server runs in production mode unless `NODE_ENV=development`; development turns the per-request access log on, and `SROUTER_ACCESS_LOG=on` forces it under either environment.

## Tests and checks

```bash
# One suite while you work
cargo test --manifest-path server/Cargo.toml --test chat_completions

# Everything, the way a release is checked
cargo test --manifest-path server/Cargo.toml --locked

cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

Suites create their own database through `server/tests/support`. They never open `~/.srouter/srouter.db`, and a new test should take the same route.

## Generated bindings

`server/bindings.ts` and its copy at `client/src/generated/typed.ts` are rendered from the wire types with specta. After changing a Rust type:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts
```

Commit the result. Hand edits do not survive the next render, and `server/tests/bindings.rs` fails when either committed copy differs from a fresh one.

## Where things live

| Path                         | Contents                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `server/src/app.rs`          | Router mounts                                                                               |
| `server/src/features/`       | One directory per feature: gateway, providers, catalog, logs, admin auth, database transfer |
| `server/src/http/`           | Middleware and static file serving                                                          |
| `server/src/infrastructure/` | Database, migrations, logging                                                               |
| `server/src/constants.rs`    | Client-facing strings and header constants                                                  |
| `server/migrations/`         | Schema history, currently version 4                                                         |
| `server/tests/`              | Integration suites and the shared support module                                            |

The contract lives in the Rust types. Response types carry the serde attributes that shape the JSON, and the route tests pin the status codes and bodies. There is no separate contract document to update alongside a change.

## Commits and pull requests

Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`) and keep the subject imperative. Say what you ran in the pull request description.

Run the full suite before pushing. This repository has no CI workflow at the moment, so nothing runs it for you.

A change that needs a dashboard, a CLI, or a documentation site should say where that piece is meant to live. Those parts of the project, along with the seven `packages/*` workspace packages, were removed in October 2026. The old code is still readable at the git branches `backup/pre-packages-removal` and `backup/pre-apps-api-removal`.

## License

Contributions are licensed under the MIT License, the same as the project.
