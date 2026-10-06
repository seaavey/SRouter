# Claude Code Provider (OAuth + Anthropic Messages executor) Implementation Plan

## Scope

Port the `claude` provider from the Node oracle: the Claude Code OAuth
authorization-code flow (login, callback, token import), the Anthropic Messages
executor behind a stored OAuth session, the live `/models` catalog, and the
lazy token refresh. `apps/api` stays the oracle; nothing is imported from
`packages/*`.

## Independent protocol analysis

The provider is the Anthropic Messages API with a Claude Code subscription
token. The protocol facts were established without reading `packages/*`:

- Reverse engineering of the official client binary (`@anthropic-ai/claude-code`
  2.1.291, `bin/claude.exe`, 2026-10-06, installed from npm for this audit):
    - the OAuth client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e` is byte-equal to
      the constant here;
    - the Messages base is `https://api.anthropic.com`, the `anthropic-version` is
      `2023-06-01`;
    - 8 of the 9 `Anthropic-Beta` flags the oracle sends are present; the binary
      no longer sends `token-efficient-tools-2026-03-28`;
    - the user-agent entrypoint is `sdk-cli` (`claude-cli/<version> (external, ...)`).
- Public, widely-reimplemented OAuth client: the client id, the `claude.ai`
  authorize host, and the `org:create_api_key user:profile user:inference` scope
  are corroborated by the coqu Claude OAuth reference, the `pacode-auth` and
  `modelbridge` Rust crates, and `grll/claude-code-login`, plus the official
  Claude Code docs for the account-token model.
- `apps/api` and the Node oracle's constant modules are the behavioural oracle,
  not the source of record for the literals.

### Endpoints

| Leg       | URL                                        | Notes                                                              |
| --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Authorize | `https://claude.ai/oauth/authorize`        | oracle value; the binary moved to `claude.com/cai/oauth/authorize` |
| Token     | `https://api.anthropic.com/v1/oauth/token` | JSON body, `client_id` only, no secret                             |
| Messages  | `https://api.anthropic.com/v1/messages`    | `{base}/messages`                                                  |
| Models    | `https://api.anthropic.com/v1/models`      | live catalog, `{ "data": [...] }`                                  |

All four are injectable through `ClaudeEndpoints`, so a test (or an operator
facing the newer hosts) points them elsewhere.

## Wire behavior (from the Node oracle, corroborated above)

- **Authorize**: `response_type=code`, `client_id`, `redirect_uri`,
  `scope`, `code_challenge`, `code_challenge_method=S256`, `state`, and an
  optional `prompt`.
- **Exchange**: JSON body with `grant_type`, `client_id`, `code`,
  `code_verifier`, `redirect_uri`. The response carries `access_token`,
  `refresh_token`, `expires_in`, and `organization_id`.
- **Refresh**: JSON body with `grant_type=refresh_token`, `client_id`,
  `refresh_token`.
- **Chat headers**: `anthropic-version`, `anthropic-beta` (base flags plus the
  heavy-agent flags for `claude-opus`/`claude-sonnet`), `authorization: Bearer`,
  the full Claude CLI fingerprint, and `anthropic-organization-id` when known.
- **Request body**: the last system message becomes the top-level `system`;
  user/assistant turns pass through; a missing `max_tokens` defaults to `4096`.
- **Response**: text blocks join, `stop_reason: max_tokens` → `length`,
  everything else → `stop`; usage is `input_tokens`/`output_tokens`.
- **Stream**: `message_start` carries the completion id; `content_block_delta`
  emits `delta.content`; `message_stop` emits `finish_reason: stop`.

## Decisions

- **D1 — one listener.** The redirect is the main listener's
  `/v1/auth/claude/callback`, rewritten onto `SROUTER_PUBLIC_URL` when set,
  exactly like OpenAI (single-port ruling, `TODO.md` section 1.4). The Node
  `:1455` listener is not ported.
- **D2 — live catalog.** No seeded models. `GET {base}/models` is fetched on
  connect and on the boot warmup, gated on the connection, so a build without a
  Claude account advertises no `claude` model.
- **D3 — oracle hosts.** The OAuth hosts are the oracle's; the newer binary hosts
  are recorded as a deviation and remain injectable.
- **D4 — client id override.** `CLAUDE_OAUTH_CLIENT_ID` is honored on the login
  route (the env override the backlog called out), falling back to the constant.
- **D5 — identity.** No id token in the Claude token response, so the account
  name is the numbered fallback (`Claude Code (Account #<last 4 of ms>)`).

## File Structure

```
server/src/features/providers/claude/
  mod.rs        # re-exports
  types.rs      # metadata, OAuth constants, beta set, CLI fingerprint, endpoints
  catalog.rs    # live /models snapshot policy
  executor.rs   # ProviderExecutor: credentials, refresh, request/response/SSE
server/src/features/provider_auth/claude.rs   # login, callback, token import
server/src/infrastructure/database/providers/credentials/claude.rs
```

## Tasks

1. types, endpoints, and credential storage — done.
2. OAuth routes (login, callback, token import) — done.
3. executor (transport + translation + refresh + catalog) — done.
4. wiring and seed (`SEED_PROVIDERS` 8 → 9) — done.
5. tests (`claude_auth.rs`, `claude_provider.rs`) — done.

## Verification

- `cargo test --test claude_auth` (7), `cargo test --test claude_provider` (5),
  the in-file unit tests, and the full suite.
- `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`.

## Follow-up (do not start without being asked)

- Port the `claude` model list to the newer `platform.claude.com` hosts if the
  oracle moves.
- Anthropic API-key mode (`x-api-key`), if a non-subscription connection is
  wanted.
