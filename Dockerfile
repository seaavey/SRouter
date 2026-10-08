# SRouter production image. Stages: the Rust server build and the Node-free
# runtime. The runtime is last, so a plain `docker build` produces the server
# image, and `--target runner` names the same stage explicitly.

# Stage 1: build the Rust server. The toolchain matches the one this crate is
# known to build with: aws-lc-sys (pulled in through the sqlx/reqwest rustls
# stack) compiles its C and assembly sources with gcc and make, no cmake or nasm.
FROM rust:1.98-alpine AS server-builder
RUN apk add --no-cache build-base perl
WORKDIR /src/server
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/tests ./tests
RUN cargo build --release --locked

# Stage 2: Node-free Rust runtime, built with `--target runner`.
FROM alpine:3.22 AS runner
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata wget
ENV PORT=3000
ENV DATABASE_PATH=/app/data/srouter.db

# SQLite WAL database, request logs, and provider state live here.
RUN mkdir -p /app/data
COPY --from=server-builder /src/server/target/release/srouter-server /app/srouter-server

EXPOSE 3000
VOLUME ["/app/data"]

# wget replaces a Node healthcheck so the image needs no Node runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["/app/srouter-server"]
