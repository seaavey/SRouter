//! Database export and import (`docs/api-database-contract.md` §"Database
//! transfer contract").
//!
//! Behavioral oracle: `apps/api/src/routes/v1/database.ts`,
//! `apps/api/src/controllers/database.controller.ts`, and
//! `apps/api/tests/database-route.test.ts`. The Node implementation's own
//! `packages/db/src/databaseTransfer.ts` is read only as evidence about the
//! incumbent; the Rust validator derives its expectations from Rust's DDL
//! (`server/migrations/*.sql`) and `docs/schemas-database.md`, never from that
//! file (the plan's D7).
//!
//! Documented deviations from Node, all recorded in
//! `docs/api-database-contract.md`:
//!
//! - The version carrier is `PRAGMA user_version`, not the
//!   `srouter_schema_meta` marker table (schemas §7-F).
//! - A legacy (v1/v2) candidate is migrated on a scratch copy before
//!   validation, so a v1 export is accepted rather than refused.
//! - The multipart body is streamed with `axum::extract::Multipart`; Node's
//!   hand-rolled boundary parser exists only because `Request.formData()`
//!   buffers, and is not ported.
//! - The transfer lock keeps both owner modes (`transfer` and `operation`).

mod multipart;
mod routes;
mod transfer;

pub use routes::create_database_router;
pub use transfer::{TransferError, export_filename, export_snapshot, import_database};
