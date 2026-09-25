use std::io;
use std::net::SocketAddr;

use axum::Router;
use tokio::net::TcpListener;

/// Serves `router` on the main listener until the process is asked to stop. The log line reports
/// `localhost` even for the wildcard bind, matching the Node API's startup message.
pub async fn serve_main(router: Router, address: SocketAddr) -> io::Result<()> {
    let listener = TcpListener::bind(address).await?;
    println!(
        "listening on http://localhost:{}",
        listener.local_addr()?.port()
    );

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("could not listen for the shutdown signal: {error}");
    }
}
