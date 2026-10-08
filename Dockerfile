# SRouter production image. Stages: the Vite dashboard, the Rust server, and the
# Node-free Rust runtime. The runtime is last, so a plain `docker build` produces
# the Rust image, and `--target runner` names the same stage explicitly.

# Stage 1: build the dashboard with Node and pnpm.
FROM node:22-alpine AS web-builder
WORKDIR /app
ENV CI=true
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_PROJECT_SPEC=0
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

# Manifests first so dependency layers survive source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/constants/package.json ./packages/constants/
COPY packages/db/package.json ./packages/db/
COPY packages/executors/package.json ./packages/executors/
COPY packages/pricing/package.json ./packages/pricing/
COPY packages/providers/package.json ./packages/providers/
COPY packages/translator/package.json ./packages/translator/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# The dashboard reads @srouter/types and @srouter/constants from source.
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm --filter web build

# Stage 2: build the Rust server. The toolchain matches the one this crate is
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

# Stage 3: Node-free Rust runtime, built with `--target runner`.
FROM alpine:3.22 AS runner
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata wget
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/srouter.db
ENV WEB_DIST_PATH=/app/web/dist

# SQLite WAL database, request logs, and provider state live here.
RUN mkdir -p /app/data
COPY --from=server-builder /src/server/target/release/srouter-server /app/srouter-server
COPY --from=web-builder /app/apps/web/dist /app/web/dist

EXPOSE 3000
VOLUME ["/app/data"]

# wget replaces the Node healthcheck so the image needs no Node runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["/app/srouter-server"]
