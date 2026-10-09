# SRouter

A self-hosted LLM gateway that speaks both the OpenAI and the Anthropic API. You run it on your own machine, connect the provider accounts you already pay for, and point every tool at one endpoint instead of juggling one key per provider.

**English** · [Bahasa Indonesia](README-id.md)

## What it does

- One endpoint for OpenAI-style (`/v1/chat/completions`) and Anthropic-style (`/v1/messages`) clients. Streaming and tool calls pass through as SSE.
- Providers include OpenCode Zen (free tier), Qoder, Cline, Grok Web, OpenAI Codex, CodeBuddy (global and CN), Google Antigravity, and Claude Code. Each one keeps its own driver: OAuth flow, token refresh, protocol translation.
- Model ids are `provider/model`, so `antigravity/gemini-3.7-flash-high` routes through the Antigravity driver. A bare model id works when exactly one provider advertises it.
- Custom OpenAI-compatible endpoints can be registered and verified from the API.
- Gateway API keys (`sr-live-...`) are separate from provider credentials. Each key carries its own rate-limit window, token quota, credit limit, and enable flag; the store keeps a sha256 hash and a display prefix, never the secret.
- Every request is logged to SQLite with provider, model, token counts, latency, status, and estimated cost. Prompt and completion text are not recorded.
- A React dashboard ships in `client/` for the admin session: login and first-run setup work, the rest of the screens are still being built (see [Current state](#current-state)).

## Run it

Requires a Rust toolchain (edition 2024, so 1.85 or newer; `server/rust-toolchain.toml` pins the channel).

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
cargo run --manifest-path server/Cargo.toml
```

The server listens on `http://127.0.0.1:3000`, keeps its SQLite database at `~/.srouter/srouter.db`, and prints its log to stdout. `server/.env.example` lists every environment variable it reads; the ones worth knowing on day one:

| Variable                 | Default                 | Purpose                                                                            |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `PORT`                   | `3000`                  | HTTP listener                                                                      |
| `DATABASE_PATH`          | `~/.srouter/srouter.db` | SQLite file                                                                        |
| `SROUTER_ADMIN_PASSWORD` | unset                   | Creates the admin account on boot, and resets its password on every boot while set |
| `WEB_DIST_PATH`          | unset                   | Built dashboard to serve at `/`                                                    |

Three things surprise people on the first run:

- `dotenvy` reads `.env` relative to the current working directory, so either start the server with cwd `server/` or export the variables yourself.
- `WEB_DIST_PATH` is a path to a build you produced, not a lookup. Build the dashboard with `bun run build` in `client/` and set `WEB_DIST_PATH=client/dist`, or leave it unset and `GET /` answers with the API info object. The path resolves against the working directory too.
- PostgreSQL is refused at boot on purpose. SQLite is the only backend.

The release binary is the same program:

```bash
cargo build --release --manifest-path server/Cargo.toml
cd server && ./target/release/srouter-server    # cwd server/ so .env applies
```

## Connect a client

OpenAI SDK, pointed at the gateway:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3000/v1",
    api_key="sr-live-your-key",
)

response = client.chat.completions.create(
    model="antigravity/gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=True,
)
```

Anthropic SDK, same gateway, Anthropic shape:

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

curl works too:

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your-key" \
  -d '{
    "model": "opencode_zen/big-pickle",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": true
  }'
```

Requests from loopback are allowed without a key until you turn on the `require_api_key` setting. Anything that arrives over the network needs one, in either `Authorization: Bearer <key>` or `x-api-key: <key>`. Supported client headers include `anthropic-version`.

## Auth and access

- **Gateway keys** are created through `POST /v1/keys` (admin session required) and returned once. Only the hash and prefix are stored, so a lost key is replaced, not recovered.
- **The admin session** is a seven-day `HttpOnly`, `SameSite=Lax` cookie, and the server checks `Origin` on mutations. Log in at `/login` in the dashboard, or through `POST /v1/admin/login`. The first admin is created with `POST /v1/admin/setup`, which only answers loopback calls, or by setting `SROUTER_ADMIN_PASSWORD` before the first boot.
- **Provider credentials** live in the `providers` table inside the same SQLite file, in the clear. Treat that file like an `.env`: readable only by the service user, out of shared backups, moved with care when you move an export.

## API

| Method                        | Path                                                                                                                     | Guard                           | Purpose                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `GET`                         | `/v1`, `/health`                                                                                                         | none                            | API info and health check                                                            |
| `POST`                        | `/v1/chat/completions`, `/v1/chat`, `/v1/chat/completion`                                                                | API key + rate limit            | OpenAI-compatible chat, streaming and not                                            |
| `POST`                        | `/v1/messages`, `/v1/messages/count_tokens`                                                                              | API key + rate limit            | Anthropic-compatible messages and token counting                                     |
| `POST`                        | `/v1/images/generations`                                                                                                 | API key + rate limit            | Image generation                                                                     |
| `GET`                         | `/v1/models`, `/v1/models/{id}`, `/v1/providers`, `/v1/providers/catalog`, `/v1/logs`, `/v1/quota`, `/v1/models/pricing` | API key                         | Read surfaces: catalog, provider connections, request logs and stats, quota, pricing |
| `GET`                         | `/v1/settings`                                                                                                           | API key                         | `require_api_key` and friends                                                        |
| `POST` `PUT` `PATCH` `DELETE` | `/v1/models...`                                                                                                          | Admin session                   | Model writes                                                                         |
| `POST` `PATCH` `DELETE`       | `/v1/providers...`                                                                                                       | Admin session                   | Custom endpoints, provider edits, round-robin weights                                |
| `GET` `POST`                  | `/v1/auth/<provider>/...`                                                                                                | Admin session; callbacks public | OAuth login and callbacks                                                            |
| `PATCH` `POST`                | `/v1/settings`                                                                                                           | Admin session                   | Settings writes                                                                      |
| `GET` `POST` `PATCH` `DELETE` | `/v1/keys...`                                                                                                            | Admin session                   | Gateway API keys and their quotas                                                    |
| `GET` `POST`                  | `/v1/admin/{status,setup,login,logout,change-password}`, `/v1/admin/database/{export,import}`                            | Per handler                     | Admin session and database transfer                                                  |

The unlisted corners (the `/v1/v1/...` compatibility alias, the callback pages mounted at the root) and a guard-by-mount table live in `skills/srouter-server/references/http-layer.md`. Errors come back in the OpenAI envelope: `{"error": {"message", "type", "code", "param"}}`. A mid-stream provider failure arrives as an SSE error event, not a broken connection.

## Dashboard

`client/` is a Bun + Vite + React 19 app. Today it has two screens, `/login` (sign-in and first-run setup) and `/` (a placeholder under the session gate), both backed by `/v1/admin/status`.

```bash
cd client
bun install
bun run dev        # http://localhost:5173, proxies /v1 to the server
bun run build      # static files for WEB_DIST_PATH
bun run typecheck
bun run lint
```

There is no test runner on the client side; `typecheck`, `lint`, and `build` are the checks.

## Development

```bash
cargo run --manifest-path server/Cargo.toml                              # run it
cargo test --manifest-path server/Cargo.toml --test chat_completions     # one suite
cargo test --manifest-path server/Cargo.toml --locked                    # everything
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

The server is one crate, no workspace and no DI container. `server/tests/` holds the integration suites, and each one builds its own temporary SQLite database and fake upstreams, so tests never touch your real data or reach a real provider. There is no CI: run the suite yourself before you push.

Wire types are shared with the client through generated TypeScript. After touching a Rust type:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts   # rewrites both committed copies
```

`server/bindings.ts` and `client/src/generated/typed.ts` are generated files. Commit both; a test fails when either drifts from a fresh render.

For deeper material, `CONTRIBUTING.md` covers the build and commit conventions, `SECURITY.md` explains where credentials live and what counts as a vulnerability, and `skills/srouter-server/` documents the crate's architecture for debugging work.

## Current state

The repository was stripped to the server crate and the dashboard in October 2026. Removed: the Node `apps/api` the Rust server was ported from, the seven `packages/*` workspace packages, the CLI, and the documentation site. The old code stays readable on the branches `backup/pre-packages-removal` and `backup/pre-apps-api-removal`.

What exists today is the server plus an early dashboard. No Dockerfile, no CI workflow, no tagged release for the current crate version yet (the last tag, v0.1.8, belongs to the Node era).

## License

[MIT](LICENSE)
