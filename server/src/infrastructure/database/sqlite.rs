use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

/// A SQLite pool whose connection can be replaced while the process keeps
/// running.
///
/// Importing a database swaps the file underneath a live server. Every
/// `AppDatabase` clone shares this handle, so a replacement made here is
/// visible to every caller that reads the pool through
/// `AppDatabase::sqlite_pool`, without restarting the process.
pub struct SqliteHandle {
    path: PathBuf,
    pool: RwLock<SqlitePool>,
}

impl SqliteHandle {
    /// Opens a SQLite pool, creating the data directory and database file when
    /// they do not exist. Existing storage is never dropped or recreated. The
    /// connection pragmas match `docs/schemas-database.md`: WAL, synchronous
    /// NORMAL, a 5s busy timeout, and foreign keys on.
    pub async fn connect(path: &Path) -> Result<Arc<Self>, sqlx::Error> {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
        }

        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_millis(5000))
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        Ok(Arc::new(Self {
            path: path.to_path_buf(),
            pool: RwLock::new(pool),
        }))
    }

    /// The file this handle points at. A replacement keeps the same path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The current pool. `SqlitePool` is an `Arc` handle, so this is a refcount
    /// bump: the lock is released before the caller runs its query, and the
    /// clone can cross an `.await` where a guard could not.
    pub fn pool(&self) -> SqlitePool {
        self.read().clone()
    }

    /// Swaps in `pool` and returns the previous one for the caller to close.
    pub fn replace(&self, pool: SqlitePool) -> SqlitePool {
        std::mem::replace(&mut *self.write(), pool)
    }

    /// A poisoned lock means another thread panicked mid-swap; the pool inside
    /// is still a valid `Arc`, so recover it instead of aborting the request.
    fn read(&self) -> RwLockReadGuard<'_, SqlitePool> {
        self.pool
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write(&self) -> RwLockWriteGuard<'_, SqlitePool> {
        self.pool
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
