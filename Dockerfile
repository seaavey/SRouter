# SRouter production image. Stages: the Vite dashboard, the Rust server, a
# Node-free Rust runtime, and the legacy Node API kept for rollback. The Node
# runtime stays last, so a plain `docker build` keeps producing the Node image
# until cutover; `--target runner` builds the Rust image.

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
COPY apps/api/package.json ./apps/api/
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

# Stage 4: the legacy Node API, selectable for rollback with
# `--target node-runner`. It disappears when apps/api is deleted.
FROM node:22-alpine AS node-builder
WORKDIR /app
ENV CI=true
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_PROJECT_SPEC=0
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/constants/package.json ./packages/constants/
COPY packages/db/package.json ./packages/db/
COPY packages/executors/package.json ./packages/executors/
COPY packages/pricing/package.json ./packages/pricing/
COPY packages/providers/package.json ./packages/providers/
COPY packages/translator/package.json ./packages/translator/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# A self-contained production dependency graph: injected workspace packages are
# copied into the deployment instead of staying symlinks into the builder.
RUN pnpm --config.inject-workspace-packages=true --filter api deploy --prod /app/deploy

FROM node:22-alpine AS node-runner
WORKDIR /app
RUN apk add --no-cache tzdata
ENV NODE_ENV=production
ENV PORT=3000
ENV OAUTH_PORT=1455
ENV DATABASE_PATH=/app/data/srouter.db
ENV WEB_DIST_PATH=/app/apps/web/dist
RUN mkdir -p /app/data
COPY --from=node-builder /app/deploy ./
COPY --from=node-builder /app/apps/web/dist ./apps/web/dist
EXPOSE 3000 1455
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
