<div align="center">

# SRouter

**A local-first AI gateway and LLM proxy for OpenAI, Anthropic, and custom models.**

Use one local endpoint to route requests, manage provider authentication, enforce quotas, and inspect usage.

<p>
  <a href="https://github.com/seaavey/SRouter/releases"><img src="https://img.shields.io/badge/version-v0.1.6-6366f1?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://hono.dev/"><img src="https://img.shields.io/badge/Hono-v4.13-e36002?style=flat-square" alt="Hono"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-v19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/demo-dark.gif">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/demo-light.gif">
    <img src="docs/images/demo-dark.gif" alt="SRouter dashboard walkthrough" width="100%">
  </picture>
</p>

</div>

## Contents

- [Quick start](#quick-start)
- [Connect coding tools](#connect-coding-tools)
- [Configure a client](#configure-a-client)
- [Supported providers](#supported-providers)
- [API endpoints](#api-endpoints)
- [Development](#development)
- [Docker Compose](#docker-compose)

## Quick Start

### Docker

```bash
docker run -d \
  --name srouter \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 1455:1455 \
  -v "$HOME/.srouter:/root/.srouter" \
  ghcr.io/seaavey/srouter:latest
```

SRouter stores its SQLite database and provider credentials in `~/.srouter` on the host.

Open `http://localhost:3000` and configure a provider from the dashboard. Then create a virtual API key from **API Keys** and test a model from **Playground**.

### Local Node.js

Requirements: Node.js 22 or later and pnpm 11.

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
pnpm install
pnpm build
pnpm start
```

The dashboard is available at `http://localhost:3000`.

## Connect Coding Tools

Install and configure the CLI from npm:

```bash
npx @srouter/cli setup
npx @srouter/cli doctor
npx @srouter/cli link claude --model claude-3-7-sonnet
npx @srouter/cli link opencode --model antigravity/gemini-3.7-flash-high
```

Run a coding tool with SRouter's proxy environment:

```bash
npx @srouter/cli run claude
```

Use `--dry-run` to preview configuration changes without writing files:

```bash
npx @srouter/cli link claude --dry-run
```

The CLI supports Claude Code and OpenCode. Configuration changes are backed up and can be restored with `unlink`.

## Configure a Client

SRouter exposes OpenAI-compatible and Anthropic-compatible endpoints.

| Setting  | Value                                 |
| -------- | ------------------------------------- |
| Base URL | `http://localhost:3000/v1`            |
| API key  | `sr-live-your_virtual_key`            |
| Models   | `GET http://localhost:3000/v1/models` |

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sr-live-your_virtual_key"
)

response = client.chat.completions.create(
    model="antigravity/gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
    baseURL: "http://localhost:3000/v1",
    apiKey: "sr-live-your_virtual_key"
});

const message = await client.messages.create({
    model: "anthropic/claude-3-7-sonnet",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello from SRouter!" }]
});

console.log(message.content[0].text);
```

### cURL

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your_virtual_key" \
  -d '{
    "model": "antigravity/gemini-3.7-flash-high",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": true
  }'
```

## Supported Providers

SRouter normalizes authentication, model routing, streaming, quotas, and protocol differences across providers.

| Provider               | Model prefix              | Authentication       |  Live quota  |
| ---------------------- | ------------------------- | -------------------- | :----------: |
| Google Antigravity     | `antigravity/*`           | OAuth 2.0 PKCE       |     Yes      |
| OpenAI Codex / ChatGPT | `openai_codex/*`          | OAuth 2.0 PKCE       |     Yes      |
| Anthropic Claude       | `anthropic/*`             | API key / OAuth      |     Yes      |
| OpenCode Zen           | `opencode_zen/*`          | Free / access token  |     Yes      |
| Amazon Q / Kiro        | `kiro/*`                  | SigV4 / API key      |     Yes      |
| Qoder                  | `qoder/*`                 | OAuth / device token |     Yes      |
| GoRouter               | `gorouter/*`              | API key              |     Yes      |
| BluesMinds             | `bluesminds/*`            | API key              |     Yes      |
| SeekAI / TabiToken     | `seekai/*`, `tabitoken/*` | API key              |     Yes      |
| Custom endpoints       | `custom/*`                | Custom headers       | Configurable |

## What SRouter Handles

- OpenAI `chat/completions` and Anthropic `messages` protocol translation
- OAuth token refresh for supported providers
- Fallback chains for rate limits and provider failures
- Virtual API keys with rate limits, token quotas, and expiration
- Cloudflare Tunnel management from the dashboard
- Request logs, token usage, quota data, and estimated costs
- Token Saver prompt processing

## API Endpoints

Most gateway endpoints use the `/v1` prefix. The health check is available at `/health`.

| Method         | Endpoint               | Purpose                           |
| -------------- | ---------------------- | --------------------------------- |
| `GET`          | `/health`              | Server health check               |
| `POST`         | `/v1/chat/completions` | OpenAI-compatible chat completion |
| `POST`         | `/v1/messages`         | Anthropic-compatible messages     |
| `GET`          | `/v1/models`           | List available models             |
| `GET`          | `/v1/models/:model`    | Inspect a model                   |
| `GET` / `POST` | `/v1/providers`        | Manage provider connections       |
| `GET` / `POST` | `/v1/keys`             | Manage virtual API keys           |
| `GET`          | `/v1/quota`            | Read provider quota data          |
| `GET`          | `/v1/logs`             | Read request logs and telemetry   |
| `GET` / `POST` | `/v1/tunnel/*`         | Manage Cloudflare Tunnel state    |

## Configuration

Copy `.env.example` to `.env` for local development. The main settings are:

| Variable             | Default                 | Purpose                                         |
| -------------------- | ----------------------- | ----------------------------------------------- |
| `PORT`               | `3000`                  | Main API and dashboard port                     |
| `OAUTH_PORT`         | `1455`                  | Local OAuth callback listener                   |
| `DATABASE_PATH`      | `~/.srouter/srouter.db` | SQLite database path                            |
| `DATABASE_URL`       | Not set                 | PostgreSQL connection string                    |
| `WEB_DIST_PATH`      | `apps/web/dist`         | Built dashboard path                            |
| `SROUTER_PUBLIC_URL` | Not set                 | Public URL for OAuth callbacks on the main port |
| `NODE_ENV`           | `development`           | Runtime environment                             |

When `SROUTER_PUBLIC_URL` is set, OAuth callbacks use the main `PORT` instead of the secondary `OAUTH_PORT` listener.

## Development

This repository is a pnpm workspace managed by Turborepo. It contains the API, web dashboard, CLI, and shared packages.

```bash
pnpm install
pnpm dev
```

The development servers use these ports:

| Service        | URL                     |
| -------------- | ----------------------- |
| API            | `http://localhost:3000` |
| Web dashboard  | `http://localhost:5173` |
| OAuth listener | `http://localhost:1455` |

Run focused checks for the app or package you changed:

```bash
pnpm --filter <app-or-package> build
pnpm --filter web lint
pnpm exec prettier --check <changed-files>
git diff --check
```

Run one test file with the package's test setup:

```bash
cd apps/api
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts
```

Do not run root `pnpm build`, `pnpm test`, or broad lint commands on resource-constrained development machines. CI runs the full build and test workflow.

## Docker Compose

```yaml
services:
    srouter:
        image: ghcr.io/seaavey/srouter:latest
        container_name: srouter
        restart: unless-stopped
        ports:
            - "3000:3000"
            - "1455:1455"
        volumes:
            - ${HOME}/.srouter:/root/.srouter
        environment:
            PORT: 3000
            NODE_ENV: production
```

## License

SRouter is distributed under the [MIT License](LICENSE).
