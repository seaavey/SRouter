---
layout: ../../layouts/DocsLayout.astro
title: Installation
description: Install SRouter with the published Docker image or run it directly from source code.
section: Start here
---

## Choose an installation path

Use Docker when you want a self-contained gateway with persistent storage. Use the source-code path when you want to develop, inspect, or modify SRouter.

| Path         | Best for                     | Requirements              |
| ------------ | ---------------------------- | ------------------------- |
| Docker image | Running SRouter quickly      | Docker Engine             |
| Source code  | Development and contribution | Git, Node.js 22+, pnpm 11 |

## Docker image

The published image includes the API and the built dashboard. It exposes the gateway on port `3000` and the OAuth callback listener on port `1455`.

Create a persistent data directory and start the container:

```bash
mkdir -p "$HOME/.srouter/data"

docker run -d \
  --name srouter \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 1455:1455 \
  -v "$HOME/.srouter/data:/app/data" \
  -e PORT=3000 \
  -e OAUTH_PORT=1455 \
  -e DATABASE_PATH=/app/data/srouter.db \
  ghcr.io/seaavey/srouter:latest
```

Open `http://localhost:3000` after the container starts. The mounted `/app/data` directory keeps the SQLite database, provider state, keys, and logs when the container is recreated.

Check the health endpoint and container logs:

```bash
curl http://localhost:3000/health
docker logs -f srouter
```

Stop or remove the container without deleting the persistent data:

```bash
docker stop srouter
docker rm srouter
```

### Docker Compose from source

If you already cloned the repository, the root Compose file builds the production image locally and uses a named `srouter_data` volume:

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
docker compose up -d --build
```

This path uses the repository `Dockerfile`, maps `3000` and `1455`, and stores runtime data in `/app/data` inside the named volume.

## Source code

Requirements:

- Node.js `22` or later
- pnpm `11.23.0` from the repository `packageManager` field
- Git

Clone the repository and install the workspace dependencies:

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
pnpm install
```

### Development mode

Run the API, dashboard, and OAuth listener through the workspace:

```bash
pnpm dev
```

The development services use these ports:

| Service                     | URL                     |
| --------------------------- | ----------------------- |
| API and OAuth-aware gateway | `http://localhost:3000` |
| React dashboard             | `http://localhost:5173` |
| OAuth callback listener     | `http://localhost:1455` |

### Production-like source run

Build the workspace, then start the API package. The API serves `apps/web/dist` when the dashboard has been built:

```bash
pnpm run build
pnpm --filter api start
```

For a different port or database location, set the environment variables before starting the API:

```bash
PORT=3000 \
DATABASE_PATH="$HOME/.srouter/srouter.db" \
pnpm --filter api start
```

The source build is the right path when changing `apps/api`, `apps/web`, `apps/cli`, or a package under `packages/`. Use focused checks from the [contributing guide](/docs/contributing/) before opening a pull request.

## After installation

1. Open the dashboard at `http://localhost:3000`.
2. Connect a provider from **Providers**.
3. Create a virtual key from **API Keys**.
4. Send a request through the `/v1` API surface.

Continue with [Getting started](/docs/getting-started/) for provider setup, configuration, and a first request.

## Source references

- Docker runtime: [`Dockerfile`](https://github.com/seaavey/SRouter/blob/main/Dockerfile)
- Docker Compose: [`docker-compose.yml`](https://github.com/seaavey/SRouter/blob/main/docker-compose.yml)
- CLI initializer: [`apps/cli/src/commands/init.ts`](https://github.com/seaavey/SRouter/blob/main/apps/cli/src/commands/init.ts)
- Workspace package manager: [`package.json`](https://github.com/seaavey/SRouter/blob/main/package.json)
