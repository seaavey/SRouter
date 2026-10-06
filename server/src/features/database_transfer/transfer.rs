//! Export, validation, and replacement of the SQLite database.
//!
//! Behavioral oracle: `packages/db/src/databaseTransfer.ts` and
//! `packages/db/src/transferLock.ts` (read as evidence about the incumbent),
//! plus the frozen contract in `docs/api-database-contract.md`. The validator
//! derives its expectations from Rust's own DDL by building a fresh in-memory
//! v3 schema and comparing against it, so no column list is copied from the
//! Node implementation (the plan's D7).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use crate::config::APIConfig;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::{AppDatabase, migrations};

use super::multipart::set_private_file_mode;

/// The upload cap, shared by the route guard and the streaming writer.
/// `MAX_DATABASE_UPLOAD_BYTES` in `database.controller.ts:24`.
pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

/// A transfer failure that maps to a frozen status and error code
/// (`docs/api-database-contract.md` §"Transfer error mapping").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferError {
    UnsupportedStorage,
    InvalidDatabase,
    InvalidMultipart,
    MissingDatabaseFile,
    InvalidDatabaseField,
    UploadTooLarge,
    ImportBusy,
    RecoveryFailed,
    TransferFailed,
}

impl TransferError {
    fn message(self) -> &'static str {
        match self {
            Self::UnsupportedStorage => constants::database::UNSUPPORTED_STORAGE,
            Self::InvalidDatabase => constants::database::INVALID_DATABASE,
            Self::InvalidMultipart => constants::database::INVALID_MULTIPART,
            Self::MissingDatabaseFile => constants::database::MISSING_DATABASE_FILE,
            Self::InvalidDatabaseField => constants::database::INVALID_DATABASE_FIELD,
            Self::UploadTooLarge => constants::database::UPLOAD_TOO_LARGE,
            Self::ImportBusy => constants::database::DATABASE_IMPORT_BUSY,
            Self::RecoveryFailed => constants::database::DATABASE_RECOVERY_FAILED,
            Self::TransferFailed => constants::database::DATABASE_TRANSFER_FAILED,
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::UnsupportedStorage => constants::code::UNSUPPORTED_STORAGE,
            Self::InvalidDatabase => constants::code::INVALID_DATABASE,
            Self::InvalidMultipart => constants::code::INVALID_MULTIPART,
            Self::MissingDatabaseFile => constants::code::MISSING_DATABASE_FILE,
            Self::InvalidDatabaseField => constants::code::INVALID_DATABASE_FIELD,
            Self::UploadTooLarge => constants::code::UPLOAD_TOO_LARGE,
            Self::ImportBusy => constants::code::DATABASE_IMPORT_BUSY,
            Self::RecoveryFailed => constants::code::DATABASE_RECOVERY_FAILED,
            Self::TransferFailed => constants::code::DATABASE_TRANSFER_FAILED,
        }
    }

    fn status(self) -> u16 {
        match self {
            Self::ImportBusy => 409,
            Self::RecoveryFailed | Self::TransferFailed => 500,
            _ => 400,
        }
    }
}

impl From<TransferError> for APIError {
    fn from(error: TransferError) -> Self {
        APIError::new(error.status(), error.message()).with_code(error.code())
    }
}

/// What an import produced, before the wire renders it.
pub struct ImportResult {
    pub backup_path: String,
    pub restart_required: bool,
    pub reauth_required: bool,
}

/// Writes a consistent snapshot of the active database to `output_path`.
///
/// `VACUUM INTO` is the same mechanism Node uses: it copies committed pages
/// through a second connection, so a live WAL writer does not corrupt it.
pub async fn export_snapshot(
    database: &AppDatabase,
    srouter_dir: &Path,
    output_path: &Path,
) -> Result<(), APIError> {
    let active = active_path(database)?;
    if output_path == active {
        return Err(TransferError::TransferFailed.into());
    }

    let _lock = TransferLock::acquire(&active, srouter_dir)?;
    let temporary = temp_sibling(output_path, "snapshot");
    let result = match snapshot_into(&active, &temporary).await {
        Ok(()) => std::fs::rename(&temporary, output_path).map_err(|error| {
            APIError::new(
                500,
                format!("could not create the database snapshot: {error}"),
            )
        }),
        Err(error) => Err(error),
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;

    set_private_file_mode(output_path)
}

/// Validates and imports `candidate_path`, replacing the active database.
///
/// A legacy (v1/v2) candidate is migrated on a scratch copy first, so the
/// uploaded bytes are never written to and a rejected upload leaves no trace.
pub async fn import_database(
    database: &AppDatabase,
    config: &APIConfig,
    candidate_path: &Path,
) -> Result<ImportResult, APIError> {
    let handle = database
        .sqlite_handle()
        .ok_or_else(|| APIError::from(TransferError::UnsupportedStorage))?;
    let active = handle.path().to_path_buf();

    if candidate_path == active {
        return Err(TransferError::InvalidDatabase.into());
    }

    // Validate the uploaded bytes as they are, then migrate a copy if needed.
    let mut effective = candidate_path.to_path_buf();
    let mut scratch: Option<ScratchFile> = None;
    let version = validate_candidate(candidate_path).await?;
    if version < SCHEMA_VERSION {
        let copy = ScratchFile(temp_sibling(&active, "candidate"));
        std::fs::copy(candidate_path, copy.path()).map_err(|error| {
            APIError::new(500, format!("could not stage the candidate copy: {error}"))
        })?;
        {
            let pool = open_read_write(copy.path()).await?;
            let migrated = migrations::run(&pool).await;
            pool.close().await;
            migrated?;
        }
        // A migrated candidate must satisfy the same v3 expectations.
        validate_candidate(copy.path()).await?;
        effective = copy.path().to_path_buf();
        scratch = Some(copy);
    }

    let result = replace_database(handle, config, &effective).await;
    // `scratch` drops here, removing the scratch copy on every path.
    drop(scratch);
    result
}

/// A scratch copy that removes itself on drop, so a candidate rejected during
/// migration or the second validation leaves no file behind.
struct ScratchFile(PathBuf);

impl ScratchFile {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for ScratchFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Reads `PRAGMA user_version` and checks the schema when it is already v3.
///
/// Returns the version so the caller can decide whether to migrate. A version
/// above [`SCHEMA_VERSION`] is refused here rather than inside the migrator, so
/// a newer file is an `invalid_database`, not a transfer failure.
pub async fn validate_candidate(candidate_path: &Path) -> Result<i64, APIError> {
    let pool = open_read_only(candidate_path)
        .await
        .map_err(|_| APIError::from(TransferError::InvalidDatabase))?;

    let outcome = async {
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&pool)
            .await
            .map_err(|_| APIError::from(TransferError::InvalidDatabase))?;
        if integrity != "ok" {
            return Err(APIError::from(TransferError::InvalidDatabase));
        }

        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .map_err(|_| APIError::from(TransferError::InvalidDatabase))?;
        if version > SCHEMA_VERSION {
            return Err(APIError::from(TransferError::InvalidDatabase));
        }
        if version == SCHEMA_VERSION {
            schema_matches(&pool)
                .await
                .map_err(|_| APIError::from(TransferError::InvalidDatabase))?;
        }
        Ok(version)
    }
    .await;

    pool.close().await;
    outcome
}

/// Replaces the active file with `candidate_path` and reopens the shared pool.
///
/// Sequence mirrors Node (`databaseTransfer.ts:454-529`): close the shared
/// connection, back up the current file, snapshot the candidate into a sibling,
/// rename over the active path, drop the stale `-wal`/`-shm`, reopen. Every
/// failure answers `database_recovery_failed`, restoring the retained backup
/// when the rename had already happened and reopening the original otherwise.
async fn replace_database(
    handle: &std::sync::Arc<crate::infrastructure::database::SqliteHandle>,
    config: &APIConfig,
    candidate_path: &Path,
) -> Result<ImportResult, APIError> {
    let active = handle.path().to_path_buf();
    let _lock = TransferLock::acquire(&active, &config.srouter_dir)?;
    let backup = backup_path(&config.srouter_dir);
    let target = temp_sibling(&active, "import");

    // Close the shared connection before snapshotting, like Node
    // (`databaseTransfer.ts:472`): the backup and the replacement then both see
    // a quiesced file. From here the pool is closed, so every exit path reopens.
    handle.pool().close().await;

    let mut renamed = false;
    let outcome: Result<(), APIError> = async {
        snapshot_into(&active, &backup).await.map_err(|error| {
            APIError::new(500, format!("could not back up the database: {error}"))
        })?;
        snapshot_into(candidate_path, &target).await?;
        std::fs::rename(&target, &active).map_err(|error| {
            APIError::new(500, format!("could not replace the database: {error}"))
        })?;
        renamed = true;
        remove_sidecars(&active);

        let pool = open_read_write(&active).await?;
        handle.replace(pool);
        Ok(())
    }
    .await;

    let _ = std::fs::remove_file(&target);

    if outcome.is_err() {
        // Node reports every replacement failure as `database_recovery_failed`
        // (`databaseTransfer.ts:495-523`): before the rename the original file
        // is reopened, after it the retained backup is restored. A reopen or
        // restore that itself fails is the branch where operator data can be
        // lost, so it collapses to the same frozen code.
        let _recovered = if renamed {
            restore(handle, &active, &backup).await.is_ok()
        } else {
            reopen(handle, &active).await.is_ok()
        };
        return Err(TransferError::RecoveryFailed.into());
    }

    Ok(ImportResult {
        backup_path: render_backup_path(&backup, &config.srouter_dir),
        restart_required: false,
        reauth_required: true,
    })
}

async fn reopen(
    handle: &std::sync::Arc<crate::infrastructure::database::SqliteHandle>,
    active: &Path,
) -> Result<(), APIError> {
    let pool = open_read_write(active).await?;
    handle.replace(pool);
    Ok(())
}

async fn restore(
    handle: &std::sync::Arc<crate::infrastructure::database::SqliteHandle>,
    active: &Path,
    backup: &Path,
) -> Result<(), APIError> {
    std::fs::copy(backup, active)
        .map_err(|error| APIError::new(500, format!("could not restore the backup: {error}")))?;
    set_private_file_mode(active)?;
    remove_sidecars(active);
    // The shared pool was closed before the rename, so the restored file must
    // be reopened or the process answers every later request from a dead pool.
    reopen(handle, active).await
}

/// `YYYYMMDDHHMMSS`, the export filename stem. Node derives it by stripping
/// every non-digit from an ISO-8601 UTC string and taking 14 characters
/// (`database.controller.ts:64-67`).
pub fn utc_stamp_14(now_ms: i64) -> String {
    let secs = now_ms.div_euclid(1000);
    let (year, month, day, hour, minute, second) = civil_from_epoch(secs);
    format!("{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}")
}

/// The export filename, `srouter-backup-<14 digits>.db`.
pub fn export_filename(now_ms: i64) -> String {
    format!("srouter-backup-{}.db", utc_stamp_14(now_ms))
}

/// Renders a backup path the way the dashboard expects: relative to
/// `<HOME>/.srouter` and prefixed with `~`, or the literal Node constant when
/// the backup somehow landed outside it (`database.controller.ts:69-76`).
fn render_backup_path(backup: &Path, srouter_dir: &Path) -> String {
    match backup.strip_prefix(srouter_dir) {
        Ok(relative) if !relative.as_os_str().is_empty() => {
            format!("~/.srouter/{}", relative.display())
        }
        _ => "~/.srouter/backups/import-backup.db".to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Schema comparison: the expectations are Rust's own DDL, read from a fresh
// in-memory v3 database, never a hard-coded list.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION: i64 = 3;

#[derive(PartialEq, Eq)]
struct Column {
    data_type: String,
    not_null: i64,
    default_value: Option<String>,
    primary_key: i64,
}

async fn schema_matches(candidate: &SqlitePool) -> Result<(), sqlx::Error> {
    let canonical = open_memory().await?;
    migrations::run(&canonical)
        .await
        .map_err(|_| sqlx::Error::RowNotFound)?;

    let expected_tables = table_names(&canonical).await?;
    let candidate_tables = table_names(candidate).await?;
    if !expected_tables.is_subset(&candidate_tables) {
        return Err(sqlx::Error::RowNotFound);
    }

    for table in &expected_tables {
        let expected = columns(&canonical, table).await?;
        let actual = columns(candidate, table).await?;
        if !columns_match(&expected, &actual) {
            return Err(sqlx::Error::RowNotFound);
        }
    }

    for index in index_names(&canonical).await? {
        if !index_names(candidate).await?.contains(&index) {
            return Err(sqlx::Error::RowNotFound);
        }
    }

    // The one constraint Node checks on its own: the key-hash index must be
    // UNIQUE and single-column, which is what actually protects key lookup.
    if !unique_single_column_index(candidate, "api_keys", "key_hash").await? {
        return Err(sqlx::Error::RowNotFound);
    }

    canonical.close().await;
    Ok(())
}

fn columns_match(expected: &BTreeMap<String, Column>, actual: &BTreeMap<String, Column>) -> bool {
    // Extra candidate columns are tolerated, matching Node's
    // `candidateColumns.length < expectedColumns.length` guard.
    expected
        .iter()
        .all(|(name, column)| actual.get(name).is_some_and(|actual| actual == column))
}

async fn table_names(pool: &SqlitePool) -> Result<BTreeSet<String>, sqlx::Error> {
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .filter(|name| !name.starts_with("sqlite_"))
        .collect())
}

async fn columns(pool: &SqlitePool, table: &str) -> Result<BTreeMap<String, Column>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT name, type, \"notnull\" AS not_null, dflt_value AS default_value, pk \
         FROM pragma_table_info(?)",
    )
    .bind(table)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let name: String = row.try_get("name").ok()?;
            Some((
                name,
                Column {
                    data_type: row.try_get::<String, _>("type").unwrap_or_default(),
                    not_null: row.try_get("not_null").unwrap_or(0),
                    default_value: row.try_get("default_value").ok().flatten(),
                    primary_key: row.try_get("pk").unwrap_or(0),
                },
            ))
        })
        .collect())
}

async fn index_names(pool: &SqlitePool) -> Result<BTreeSet<String>, sqlx::Error> {
    let rows =
        sqlx::query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect())
}

async fn unique_single_column_index(
    pool: &SqlitePool,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let indexes = sqlx::query("SELECT name, \"unique\" AS is_unique FROM pragma_index_list(?)")
        .bind(table)
        .fetch_all(pool)
        .await?;

    for index in &indexes {
        if index.try_get::<i64, _>("is_unique").unwrap_or(0) != 1 {
            continue;
        }
        let name: String = index.try_get("name").unwrap_or_default();
        let columns = sqlx::query("SELECT name FROM pragma_index_info(?)")
            .bind(&name)
            .fetch_all(pool)
            .await?;
        if columns.len() == 1
            && columns
                .first()
                .and_then(|row| row.try_get::<String, _>("name").ok())
                .as_deref()
                == Some(column)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

// ---------------------------------------------------------------------------
// Filesystem helpers.
// ---------------------------------------------------------------------------

fn active_path(database: &AppDatabase) -> Result<PathBuf, APIError> {
    database
        .sqlite_path()
        .map(Path::to_path_buf)
        .ok_or_else(|| APIError::from(TransferError::UnsupportedStorage))
}

fn temp_sibling(base: &Path, kind: &str) -> PathBuf {
    let name = base
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "database".to_owned());
    base.with_file_name(format!(
        "{name}.{kind}-{}-{}",
        std::process::id(),
        crate::clock::now_ms()
    ))
}

fn backup_path(srouter_dir: &Path) -> PathBuf {
    srouter_dir
        .join("backups")
        .join(format!("import-backup-{}.db", crate::clock::now_ms()))
}

fn remove_sidecars(database_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = database_path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(sidecar));
    }
}

/// `VACUUM INTO`, the consistent-copy mechanism Node uses. The target path is
/// a SQLite string literal, so single quotes are doubled.
async fn snapshot_into(source: &Path, output: &Path) -> Result<(), APIError> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            APIError::new(
                500,
                format!("could not create the snapshot directory: {error}"),
            )
        })?;
    }

    let pool = open_read_write(source).await?;
    let escaped = output.to_string_lossy().replace('\'', "''");
    let statement = format!("VACUUM INTO '{escaped}'");
    let result = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .execute(&pool)
        .await;
    pool.close().await;
    result.map_err(|error| {
        APIError::new(
            500,
            format!("could not create the database snapshot: {error}"),
        )
    })?;

    set_private_file_mode(output)
}

async fn open_read_only(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
}

async fn open_read_write(path: &Path) -> Result<SqlitePool, APIError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .busy_timeout(Duration::from_millis(5000));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| APIError::new(500, format!("could not open the database: {error}")))
}

async fn open_memory() -> Result<SqlitePool, sqlx::Error> {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
}

// ---------------------------------------------------------------------------
// Transfer lock (`transferLock.ts`): one file, two owner modes.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct LockOwner {
    pid: u32,
    /// `start` for a transfer lock, `mode` for an operation lock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    token: String,
}

/// A held transfer lock; released on drop.
struct TransferLock {
    path: PathBuf,
    token: String,
}

impl TransferLock {
    fn acquire(active: &Path, srouter_dir: &Path) -> Result<Self, APIError> {
        std::fs::create_dir_all(srouter_dir).map_err(|error| {
            APIError::new(500, format!("could not create the data directory: {error}"))
        })?;

        let path = lock_path(active);
        let token = uuid::Uuid::new_v4().to_string();
        let owner = LockOwner {
            pid: std::process::id(),
            start: Some(process_start_identity(std::process::id())),
            mode: None,
            token: token.clone(),
        };

        match write_lock_new(&path, &owner) {
            Ok(()) => Ok(Self { path, token }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                Self::handle_existing(&path, token)
            }
            Err(error) => Err(APIError::new(
                500,
                format!("could not create the transfer lock: {error}"),
            )),
        }
    }

    /// A live owner is busy. A dead owner's lock is quarantined and reclaimed.
    /// An `operation` owner (the CLI) is always busy: the transfer must not
    /// steal the guard that protects an in-flight operation.
    fn handle_existing(path: &Path, token: String) -> Result<Self, APIError> {
        let existing = std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LockOwner>(&raw).ok())
            .ok_or_else(|| APIError::from(TransferError::ImportBusy))?;

        if existing.mode.as_deref() == Some("operation") || owner_is_live(&existing) {
            return Err(TransferError::ImportBusy.into());
        }

        // Quarantine, then re-check the token before deleting, so a lock that
        // changed hands between read and rename is never removed.
        let quarantine = path.with_file_name(format!(
            "{}.stale-{}-{}",
            path.file_name().unwrap_or_default().to_string_lossy(),
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::rename(path, &quarantine)
            .map_err(|_| APIError::from(TransferError::ImportBusy))?;
        let quarantined = std::fs::read_to_string(&quarantine)
            .ok()
            .and_then(|raw| serde_json::from_str::<LockOwner>(&raw).ok());
        let reclaimable = quarantined
            .as_ref()
            .is_some_and(|owner| owner.token == existing.token);
        let _ = std::fs::remove_file(&quarantine);

        if !reclaimable {
            return Err(TransferError::ImportBusy.into());
        }

        let owner = LockOwner {
            pid: std::process::id(),
            start: Some(process_start_identity(std::process::id())),
            mode: None,
            token: token.clone(),
        };
        write_lock_new(path, &owner).map_err(|_| APIError::from(TransferError::ImportBusy))?;
        Ok(Self {
            path: path.to_path_buf(),
            token,
        })
    }
}

impl Drop for TransferLock {
    fn drop(&mut self) {
        // Only remove a lock we still own.
        let owned = std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LockOwner>(&raw).ok())
            .is_some_and(|owner| owner.token == self.token);
        if owned {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn lock_path(active: &Path) -> PathBuf {
    let mut name = active.as_os_str().to_os_string();
    name.push(".transfer.lock");
    PathBuf::from(name)
}

fn write_lock_new(path: &Path, owner: &LockOwner) -> std::io::Result<()> {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(serde_json::to_string(owner)?.as_bytes())?;
    set_private_file_mode(path).map_err(std::io::Error::other)?;
    Ok(())
}

fn owner_is_live(owner: &LockOwner) -> bool {
    let stat = format!("/proc/{}/stat", owner.pid);
    if !Path::new(&format!("/proc/{}", owner.pid)).exists() {
        return false; // pid gone: stale
    }
    match std::fs::read_to_string(&stat) {
        Ok(content) => match owner.start.as_deref() {
            // A pid that exists with a different start identity is a recycled
            // pid, so the lock is stale.
            Some(expected) => process_start_from(&content).as_deref() == Some(expected),
            None => true,
        },
        // The pid exists but its stat is unreadable (another user): treat it as
        // live rather than stealing a lock we cannot inspect.
        Err(_) => true,
    }
}

fn process_start_identity(pid: u32) -> String {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|content| process_start_from(&content))
        .unwrap_or_else(|| "unknown".to_owned())
}

/// Field 22 of `/proc/<pid>/stat`: the value after the last `)`, index 19 of
/// the remainder (`databaseTransfer.ts:445-452`).
fn process_start_from(stat: &str) -> Option<String> {
    let after_comm = &stat[stat.rfind(')')? + 1..];
    after_comm.split_whitespace().nth(19).map(str::to_owned)
}

/// Civil date from Unix seconds (Howard Hinnant's algorithm), reused rather
/// than pulling in `chrono`/`time` for one filename.
fn civil_from_epoch(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86400);
    let day_secs = secs.rem_euclid(86400);
    let hour = (day_secs / 3600) as u32;
    let minute = ((day_secs % 3600) / 60) as u32;
    let second = (day_secs % 60) as u32;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { year + 1 } else { year };

    (year, month, day, hour, minute, second)
}
