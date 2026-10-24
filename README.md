# SRouter

**One self-hosted endpoint for the LLM accounts you already pay for.** SRouter is an LLM gateway that speaks both the OpenAI and the Anthropic API, so Claude Code, Cursor, Cline, the OpenAI SDKs, and anything else expecting one of those shapes can point at a single base URL instead of juggling a key per provider.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Rust: edition 2024](https://img.shields.io/badge/rust-edition%202024-dea584.svg)](server/Cargo.toml)
[![Storage: SQLite](https://img.shields.io/badge/storage-SQLite-003b57.svg)](server/migrations)

**English** · [Bahasa Indonesia](README-id.md)

[Why SRouter](#why-srouter) · [Quick start](#quick-start) · [Connect a client](#connect-a-client) · [Providers](#providers) · [Configuration](#configuration) · [API](#api) · [Dashboard](#dashboard) · [Architecture](#architecture) · [Development](#development) · [Deployment](#deployment) · [Troubleshooting](#troubleshooting) · [Security](#security) · [Benchmarks](#benchmarks) · [Project status](#project-status) · [License](#license)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/benchmark-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/benchmark-light.png">
  <img alt="Three-panel chart comparing the gateways on one host: 8,675 vs 525 vs 354 requests per second at concurrency 50, 15 vs 131 vs 424 MB idle memory, and 5.5 vs 86.4 vs 123.1 ms median latency." src="assets/benchmark-light.png" width="100%">
</picture>

One host, one load generator, three gateways. Method, caveats, and the table are in [Benchmarks](#benchmarks).


## Why SRouter

- **One endpoint, two protocols.** `/v1/chat/completions` for OpenAI-shaped clients and `/v1/messages` for Anthropic-shaped ones. Streaming, tool calls, and images pass through; a provider failure mid-stream arrives as an SSE error event instead of a dropped connection.
- **The accounts you already have.** Nine drivers cover OpenCode Zen (free tier), Qoder, Cline, Grok Web, OpenAI Codex, CodeBuddy (global and CN), Google Antigravity, and Claude Code. Each keeps its own OAuth flow, token refresh, and protocol translation.
- **Keys that belong to the gateway.** Gateway keys (`sr-live-…`) are separate from provider credentials and carry their own rate-limit window, token quota, credit limit, model allowlist, and enable flag. Only a sha256 hash and a display prefix are stored, so a lost key is replaced, never recovered.
- **You can see what happened.** Every request is logged to SQLite with provider, model, token counts, latency, status, and estimated cost, and the dashboard charts them live over SSE. Prompt and completion text are never recorded.
- **One binary, one file, no services.** Rust/Axum server, SQLite storage, no Postgres, no Redis, no queue. `docker compose up -d` is the whole install.

## Quick start

### Docker

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
SROUTER_ADMIN_PASSWORD='pick-something-long' docker compose up -d
```

Open <http://localhost:3000>, sign in with that password, connect a provider on **Providers**, create a key on **Keys**, and point a client at `http://localhost:3000/v1`. The container serves the API and the dashboard on one port and keeps its database at `~/.srouter/srouter.db` (mounted to `/data`).

Change the published port with `SROUTER_PORT` (`SROUTER_PORT=8080 docker compose up -d`). Without Compose: `docker build -t srouter .` and then `docker run -p 3000:3000 -v ~/.srouter:/data -e SROUTER_ADMIN_PASSWORD=... srouter`.

### From source

Requires a stable Rust toolchain (edition 2024, so 1.85 or newer; `server/rust-toolchain.toml` pins the channel).

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
cargo run --manifest-path server/Cargo.toml
```

The server listens on <http://127.0.0.1:3000> and keeps its database at `~/.srouter/srouter.db`. To serve the dashboard from that same process, build it once and point `WEB_DIST_PATH` at the output:

```bash
cd client && bun install && bun run build && cd ..
WEB_DIST_PATH=client/dist cargo run --manifest-path server/Cargo.toml
```

### First run

1. **Create the admin account.** Open `/login` in the dashboard, or `POST /v1/admin/setup`, which only answers loopback calls. Setting `SROUTER_ADMIN_PASSWORD` before boot does it too, and resets the password on every boot while it stays set.
2. **Connect a provider.** Qoder, Cline, Codex, CodeBuddy, Antigravity, and Claude start an OAuth flow from the dashboard; Grok Web takes a cookie or SSO token; OpenCode Zen needs no account at all.
3. **Create a gateway key.** The full secret (`sr-live-...`) is shown once, on creation.
4. **Point a client at the gateway.** Base URL `http://127.0.0.1:3000/v1`, with the key in `Authorization: Bearer <key>` or `x-api-key: <key>`.

Requests from loopback are allowed without a key until you turn on the `require_api_key` setting. Anything arriving over the network always needs one.

## Connect a client

OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:3000/v1", api_key="sr-live-your-key")

response = client.chat.completions.create(
    model="antigravity/gemini-3.8-flash-high",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=True,
)
```

Anthropic SDK, same gateway:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://127.0.0.1:3000/v1",
  apiKey: "sr-live-your-key",
});

const message = await client.messages.create({
  model: "claude/claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello from SRouter!" }],
});
```

curl:

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your-key" \
  -d '{"model": "opencode_zen/big-pickle", "messages": [{"role": "user", "content": "Ping!"}], "stream": true}'
```

Model ids are `provider/model`, so `antigravity/gemini-3.8-flash-high` resolves through the Antigravity driver. A bare id also works when exactly one provider advertises it. `GET /v1/models` tells you what is reachable right now, and `anthropic-version` is accepted on the Anthropic routes.

## Providers

| Driver         | Auth               | Catalog                                                                |
| -------------- | ------------------ | ---------------------------------------------------------------------- |
| `opencode_zen` | none               | static, with the FreeTier gate tools                                   |
| `qoder`        | device flow        | live `model/list`, two advertised names per model                      |
| `cline`        | WorkOS device flow | live `/api/v1/models`, connection-gated                                |
| `grok-web`     | cookie / SSO       | connection-gated                                                       |
| `codebuddy`    | OAuth              | official package `product.json` merged with the live enterprise config |
| `codebuddy-cn` | OAuth              | same driver, CN endpoints                                              |
| `antigravity`  | Google OAuth       | static 17-id CloudCode catalog                                         |
| `claude`       | OAuth              | live `GET {base}/models` snapshot                                      |
| `openai_codex` | ChatGPT OAuth      | live `GET /backend-api/codex/models`                                   |

`GET /v1/providers/catalog` lists what is registered; `GET /v1/providers` lists the connections and their state. Custom OpenAI-compatible endpoints can be added, verified, and removed from the API or the dashboard.

## Configuration

Every setting is an environment variable, and [`server/.env.example`](server/.env.example) documents all of them. The ones worth knowing on day one:

| Variable                                                           | Default                 | Purpose                                                                               |
| ------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------- |
| `PORT`                                                             | `3000`                  | HTTP listener                                                                         |
| `DATABASE_PATH`                                                    | `~/.srouter/srouter.db` | SQLite file (the Docker image uses `/data/srouter.db`)                                |
| `WEB_DIST_PATH`                                                    | unset                   | Built dashboard to serve at `/`; unset means `GET /` answers with the API info object |
| `SROUTER_ADMIN_PASSWORD`                                           | unset                   | Creates the admin account on boot, and resets its password on every boot while set    |
| `SROUTER_PUBLIC_URL`                                               | unset                   | Canonical public origin; an `https://` value turns secure cookies on                  |
| `SROUTER_CORS_ORIGINS`                                             | unset                   | Comma-separated origin allowlist (loopback origins are always allowed)                |
| `SROUTER_SECURE_COOKIES`                                           | `false`                 | Adds `Secure` to the admin session cookie                                             |
| `SROUTER_TRUST_CF_CONNECTING_IP`                                   | `false`                 | Trust `cf-connecting-ip`; only when a Cloudflare proxy is the sole caller             |
| `SROUTER_UPSTREAM_CONCURRENCY`                                     | `100`                   | In-flight upstream cap; saturation answers `429` before any vendor call               |
| `SROUTER_ACCESS_LOG`                                               | `off`                   | Per-request access log with redacted query, headers, and body                         |
| `SROUTER_FILE_LOG`                                                 | `false`                 | Also write `logs/srouter-server.log` instead of stdout only                           |
| `RUST_LOG`                                                         | `info`                  | Log level                                                                             |
| `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL` | unset                   | Optional search backends for the built-in search tool                                 |

`NODE_ENV` is not a switch: production is the only mode the binary boots, and `development` is refused. PostgreSQL is refused the same way: a configured `DATABASE_URL` stops the process at boot, because SQLite is the only backend with a schema.

## API

| Method                        | Path                                                                                   | Guard                           | Purpose                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `GET`                         | `/v1`, `/health`                                                                       | none                            | API info and health check                                    |
| `POST`                        | `/v1/chat/completions`, `/v1/chat`, `/v1/chat/completion`                              | API key + rate limit            | OpenAI-compatible chat, streaming or buffered                |
| `POST`                        | `/v1/messages`, `/v1/messages/count_tokens`                                            | API key + rate limit            | Anthropic-compatible messages and token counting             |
| `POST`                        | `/v1/images/generations`                                                               | API key + rate limit            | Image generation                                             |
| `GET`                         | `/v1/models`, `/v1/models/{*model}`                                                    | API key                         | Catalog with allowlist, favorites, and hidden models applied |
| `GET`                         | `/v1/models/pricing`                                                                   | API key                         | models.dev pricing snapshot                                  |
| `GET`                         | `/v1/quota` (alias `/v1/qouta`)                                                        | Admin session                   | Provider quota                                               |
| `GET`                         | `/v1/logs`, `/v1/logs/{id}`, `/v1/logs/stats`, `/v1/logs/analytics`, `/v1/logs/events` | Admin session                   | Request logs, aggregates, and the SSE stream                 |
| `GET`                         | `/v1/providers`, `/v1/providers/catalog`, `/v1/providers/{id}`                         | Admin session                   | Connections, catalog, and one provider                       |
| `GET`                         | `/v1/settings`                                                                         | API key                         | `require_api_key`                                            |
| `POST` `PUT` `PATCH` `DELETE` | `/v1/models/{*model}`                                                                  | Admin session                   | Model writes                                                 |
| `PATCH`                       | `/v1/providers/{id}`, `/v1/providers/{id}/round-robin`                                 | Admin session                   | Provider edits and account rotation                          |
| `POST` `DELETE`               | `/v1/providers`, `/v1/providers/verify`, `/v1/providers/connections/verify`            | Admin session                   | Custom providers and their verification                      |
| `GET` `POST`                  | `/v1/auth/{qoder,cline,codebuddy,codebuddy-cn,grok-web,openai,antigravity,claude}/...` | Admin session; callbacks public | OAuth login and callbacks                                    |
| `GET` `POST` `PATCH` `DELETE` | `/v1/keys`, `/v1/keys/{id}`, `/v1/keys/{id}/credit`                                    | Admin session                   | Gateway keys, quotas, and credit                             |
| `GET` `POST` `PATCH`          | `/v1/users`, `/v1/users/{id}`, `/v1/users/{id}/token`                                  | Admin session                   | Customer accounts and their login tokens                     |
| `POST`                        | `/v1/portal/login`                                                                     | none; throttled                 | Customer token sign-in                                       |
| `GET` `POST`                  | `/v1/portal/{me,logs,logout}`                                                          | Customer session                | Customer console reads and sign-out                          |
| `POST` `PATCH`                | `/v1/settings`                                                                         | Admin session                   | Settings writes                                              |
| `GET` `POST`                  | `/v1/admin/{status,setup,login,logout,change-password}`                                | Per handler                     | Admin session                                                |
| `GET` `POST`                  | `/v1/admin/database/{export,import}`                                                   | Admin session                   | Database transfer                                            |

Errors use the OpenAI envelope: `{"error": {"message", "type", "code", "param"}}`. The `/v1/v1/...` compatibility alias and the guard-by-mount table are documented in [`skills/srouter-server/references/http-layer.md`](skills/srouter-server/references/http-layer.md).

## Dashboard

`client/` is a Bun + Vite + React 19 app: TanStack Router and Query, Tailwind v4, shadcn on Base UI, plus a local `arc/` component kit.

| Screen                                 | State                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `/login`                               | sign-in and first-run setup                                                        |
| `/`                                    | overview: windowed analytics, live SSE events, model and provider breakdowns       |
| `/providers`, `/providers/$providerId` | live: connection modals, health checks, duplicate detection                        |
| `/logs`                                | live: paginated table, SSE tail, bottom-sheet request detail                       |
| `/usage`                               | live: quota, per-model spend, period breakdown                                     |
| `/keys`                                | live: create, edit, credit, model allowlist                                        |
| `/users`                               | live: list, create, rename, enable/disable, re-issue login token                   |
| `/portal`                              | live: customer console; token sign-in, own keys and request logs                   |
| `/settings`                            | static mockup: the admin-password and database-export buttons have no handlers yet |

```bash
cd client
bun install
bun run dev        # http://localhost:5173, proxies /v1 to the server
bun run build      # static files for WEB_DIST_PATH
bun run typecheck
bun run lint
```

There is no client test runner; `typecheck`, `lint`, and `build` are the checks.

## Architecture

Two halves in one repository, sharing only generated TypeScript.

| Path                   | What lives there                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server/`              | Rust/Axum gateway: routes, middleware, provider drivers, SQLite stores, integration suites                           |
| `client/`              | The operator dashboard                                                                                               |
| `server/src/app.rs`    | The only router assembly; guards are applied per mount                                                               |
| `server/src/features/` | One directory per feature: gateway, providers, catalog, logs, api_keys, admin_auth, provider_auth, database_transfer |
| `server/migrations/`   | Schema history, currently version 7                                                                                  |
| `server/tests/`        | Integration suites, each with its own temporary database and fake upstreams                                          |
| `skills/`              | Deep-dive notes for server and client work                                                                           |

A request goes router → per-mount guard → feature handler → model resolution → provider driver → upstream, and the answer streams back as SSE. Wire types derive `specta::Type` in Rust, and `cargo run --bin export_ts` renders them into `server/bindings.ts` and `client/src/generated/typed.ts`; a test fails when either copy drifts from a fresh render.

## Development

```bash
cargo run --manifest-path server/Cargo.toml                              # run
cargo test --manifest-path server/Cargo.toml --test chat_completions     # one suite
cargo test --manifest-path server/Cargo.toml --locked                    # everything
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo run --manifest-path server/Cargo.toml --bin export_ts              # regenerate bindings
```

`make` wraps the same commands (`make check` is fmt + clippy + tests), plus `make image`, `make up`, and `make web`.

Tests never touch your real database or a real provider: every suite builds a temporary SQLite file and fake upstreams. Two live probes (`opencode_live.rs`, `qoder_live.rs`) are network-gated and ignored by default; run them with `--ignored`. CI re-runs `fmt`, `clippy`, the suite, and the bindings-drift check on pushes to `main` and pull requests into it, but run the suite yourself before you push.

Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, ...); [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

## Deployment

`Dockerfile` builds the server and the dashboard into one image on `gcr.io/distroless/cc-debian12:nonroot`, with `HOME=/data`, `DATABASE_PATH=/data/srouter.db`, and `WEB_DIST_PATH=/web`. `docker-compose.yml` runs that image as a single `srouter` service with a named volume.

- **Publish an image:** Actions -> `docker-publish` -> _Run workflow_. It is manual on purpose and never fires on a push or a tag.
- **Back up:** `GET /v1/admin/database/export` (admin session) writes a portable copy, and `POST /v1/admin/database/import` restores one.
- **Stop safely:** `docker compose down` stops the container and keeps the volume. `docker compose down -v` deletes the volume, which holds the SQLite database and therefore every provider credential.
- **Upgrade:** pull the new image and restart. Migrations run on connect, and a schema newer than the binary understands is refused, so a downgrade needs the backup taken before the upgrade.

## Troubleshooting

| Symptom                                         | Cause                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /` returns JSON, not the dashboard         | `WEB_DIST_PATH` is unset, or points at a directory that does not exist                                |
| `.env` seems ignored                            | `dotenvy` reads it from the current working directory; run with cwd `server/` or export the variables |
| The process exits at boot mentioning PostgreSQL | `DATABASE_URL` is set; unset it and use `DATABASE_PATH`                                               |
| `401` with `code=api_key_disabled`              | The key exists but is disabled; enable it from the dashboard or `PATCH /v1/keys/{id}`                 |
| `429` on a request that used to work            | The key's rate-limit window, its token quota, or the `SROUTER_UPSTREAM_CONCURRENCY` cap               |
| Locked out of the admin account                 | Boot once with `SROUTER_ADMIN_PASSWORD` set; it resets the password while it stays set                |
| A provider connection drops after a while       | OAuth tokens refresh in the background; re-connect the account if the vendor revoked the grant        |

## Security

Provider credentials are stored in cleartext inside the SQLite file, so treat that file like a `.env`: readable only by the service user, and never in a shared backup. Gateway keys are stored as a sha256 hash plus a prefix and cannot be recovered. Request logs keep metadata only, with no prompt or completion text. To report a vulnerability, use the private channel in [`SECURITY.md`](SECURITY.md), not a public issue.

## Benchmarks

Three gateways, one host, same load generator, run one at a time: this server, `9router@0.5.104`, and `omniroute@3.8.51`. Each was measured on the cheapest route it exposes to an unauthenticated caller (`/health` here, `/api/health` for the two Node gateways), 20 seconds at concurrency 50, with RSS summed over the process tree.

|                | SRouter        | 9Router            | OmniRoute          |
| -------------- | -------------- | ------------------ | ------------------ |
| Runtime        | Rust/Axum      | Next.js 16 on Node | Next.js on Node    |
| Shipped size   | 25.4 MB binary | 76 MB npm package  | 2.8 GB npm package |
| Cold start     | 0.06-0.12 s    | 3.1-3.5 s          | 9.3-12.5 s         |
| Idle RSS       | 15-17 MB       | 131 MB             | 424 MB             |
| RSS after load | 19-22 MB       | 487 MB             | 824 MB             |
| Throughput     | 8,675 req/s    | 525 req/s          | 354 req/s          |
| p50 / p95      | 5.5 / 8.5 ms   | 86 / 147 ms        | 123 / 206 ms       |

Read this as gateway overhead, not chat speed: no provider credentials were configured for any of the three, so every request stops at the gateway and never reaches an upstream. The routes are also not identical work, since `/health` here returns a static body while the Node health routes pass through their web framework. The catalog row is the closer comparison: `/v1/models` answers in 785 bytes here against 317 KB (824 models) for 9Router, which falls to 5.2 req/s at concurrency 10 against 1,713 req/s here.

Measured 2026-10-17 on one 4-vCPU host, sequentially, with a keep-alive Node generator at 50 workers for 20 s per run. The in-repo harness in `server/src/benchmark/` covers the gateway's own throughput on a mixed chat workload and is not what produced this table.

## Project status

The repository was stripped to the Rust server and the dashboard in October 2026: the Node `apps/api` the server was ported from, the seven `packages/*` workspace packages, the CLI, and the documentation site are gone. The old code stays readable on the branches `backup/pre-apps-api-removal` and `backup/pre-packages-removal`.

The server implements the contract the Node API defined; the dashboard is still filling in screens (see [Dashboard](#dashboard)). There is no tagged release for the current crate yet: the last tag, `v0.1.8`, belongs to the Node era.

## License

[MIT](LICENSE)

---

Working with an AI agent? [`llms.txt`](llms.txt) is a compact, machine-readable brief, [`AGENTS.md`](AGENTS.md) holds the contributor rules, and [`skills/`](skills/) has the deep dives.
