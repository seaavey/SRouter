//! Process-wide logging: one `tracing` subscriber feeding stdout and a log file.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry;

const LOG_FILE: &str = "srouter-server.log";

/// Installs the subscriber before anything else runs. By default, logs only to stdout
/// (for terminal, journald, and Docker) so no `srouter-server.log` file is written.
/// File logging under `logs/srouter-server.log` can be explicitly enabled with `SROUTER_FILE_LOG=true`.
pub fn init() {
    let enable_file_log = std::env::var("SROUTER_FILE_LOG")
        .map(|value| value.eq_ignore_ascii_case("true") || value == "1")
        .unwrap_or(false);

    if enable_file_log {
        if let Err(error) = init_in(Path::new("logs")) {
            eprintln!("file logging under logs/ is disabled: {error}");
            let _ = tracing_subscriber::fmt()
                .with_env_filter(filter())
                .try_init();
        }
    } else {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter())
            .try_init();
    }
}

/// Appends to `directory/srouter-server.log` and installs the global subscriber, returning
/// the file path. Called by `init()` and, once per process, by the telemetry test.
pub fn init_in(directory: &Path) -> io::Result<PathBuf> {
    std::fs::create_dir_all(directory)?;
    let path = directory.join(LOG_FILE);
    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    let subscriber = registry().with(filter()).with(fmt::layer()).with(
        fmt::layer()
            .with_ansi(false)
            .with_writer(SharedFile::new(file)),
    );
    tracing::subscriber::set_global_default(subscriber).map_err(io::Error::other)?;
    Ok(path)
}

fn filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

/// One append handle shared with the file layer; concurrent events serialize through the lock.
#[derive(Clone)]
struct SharedFile(Arc<Mutex<std::fs::File>>);

impl SharedFile {
    fn new(file: std::fs::File) -> Self {
        Self(Arc::new(Mutex::new(file)))
    }

    fn lock(&self) -> io::Result<std::sync::MutexGuard<'_, std::fs::File>> {
        self.0
            .lock()
            .map_err(|_| io::Error::other("log file lock poisoned"))
    }
}

impl Write for SharedFile {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.lock()?.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.lock()?.flush()
    }
}

impl<'a> MakeWriter<'a> for SharedFile {
    type Writer = SharedFile;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}
