# syntax=docker/dockerfile:1

# Three stages, one runtime. The server stage compiles the crate, the web stage
# builds the dashboard, and the runtime carries the two artifacts and nothing
# else: distroless already ships glibc, libgcc, ca-certificates, tzdata and /tmp.

FROM rust:1.99-bookworm AS server
WORKDIR /src
# migrations/ is compile-time input: migrations.rs embeds the .sql files with
# include_str!. rust-toolchain.toml is deliberately absent -- the image tag pins
# the toolchain, and copying it only invites a rustup fetch inside the build.
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations
# scripts/ is compile-time input too: provider_auth embeds the relay it serves
# with include_str!.
COPY server/scripts ./scripts
# target/ lives in a cache mount, and a cache mount is not a layer, so the binary
# is copied into the image inside this same RUN. --config strips the release
# binary without adding binutils here or a profile to Cargo.toml.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin srouter-server \
      --config 'profile.release.strip="symbols"' \
 && cp target/release/srouter-server /srouter-server \
 && mkdir -p /data \
 && chown 65532:65532 /data

FROM oven/bun:1.4.3-slim AS web
WORKDIR /src
# Manifest first so the install layer survives a source-only change.
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
# client/node_modules and client/dist are in .dockerignore, so this cannot
# clobber the tree installed above nor import a stale host dist.
COPY client/ ./
RUN bun run build

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /srouter-server /srouter-server
# uid 65532 owns /data so a fresh named volume inherits a writable directory and
# the process never needs root.
COPY --from=server --chown=65532:65532 /data /data
COPY --from=web /src/dist /web
# NODE_ENV is absent on purpose: unset already means production (config.rs), and
# SROUTER_FILE_LOG stays off so the log is stdout, i.e. `docker logs`.
ENV HOME=/data \
    DATABASE_PATH=/data/srouter.db \
    WEB_DIST_PATH=/web
EXPOSE 3000
VOLUME /data
# docker stop sends SIGTERM, but the shutdown hook listens for SIGINT only
# (http/listeners.rs), so the default would SIGKILL the process mid-stream.
STOPSIGNAL SIGINT
ENTRYPOINT ["/srouter-server"]
