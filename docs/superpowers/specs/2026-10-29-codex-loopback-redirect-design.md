# Codex OAuth: keep the loopback redirect

Date: 2026-10-29
Status: draft, awaiting owner approval

## Intent

The `openai_codex` provider cannot be connected from the hosted dashboard
(`https://seavx.ai.id/providers/openai_codex`). Approving the login at
`auth.openai.com` returns `400 invalid_authorize_request`, so no account is
ever stored. The connect button must produce an authorization URL the vendor
accepts.

## Why it fails today

`login()` in `server/src/features/provider_auth/openai.rs` runs the caller's
`redirect_uri` through `resolve_callback_url()`
(`provider_auth/mod.rs:350`), which rewrites any loopback URI onto
`SROUTER_PUBLIC_URL`. Production sets that to `https://seavx.ai.id`, so the
dashboard's `http://localhost:1455/auth/callback` becomes
`https://seavx.ai.id/v1/auth/callback`.

The OAuth client `app_EMoamEEZ73f0CkXaXp7hrann` only allows loopback redirects.
Probed against the live endpoint on 2026-10-29 with the same `client_id`,
scope, PKCE challenge and state:

| redirect_uri                            | result                        |
| --------------------------------------- | ----------------------------- |
| `http://localhost:1455/auth/callback`   | 200, sign-in page             |
| `http://localhost:1457/auth/callback`   | 200, sign-in page             |
| `http://127.0.0.1:1455/auth/callback`   | 200, sign-in page             |
| `http://localhost:3000/v1/auth/callback`| 400 `invalid_authorize_request` |
| `https://seavx.ai.id/v1/auth/callback`  | 400 `invalid_authorize_request` |
| `https://example.com/v1/auth/callback`  | 400 `invalid_authorize_request` |

The rewrite is therefore the defect: the module's own `//!` comment already
states the vendor accepts loopback only, while the code rewrites it away.

## Goals

- A login from the hosted dashboard returns an authorization URL the vendor
  accepts, with `redirect_uri` left as the registered loopback URI.
- The default redirect (no `redirect_uri` supplied) is a value the vendor
  accepts, not the public origin.
- `POST /v1/auth/openai/callback` keeps working: the exchange sends back the
  same `redirect_uri` the login used, and the browser paste box in
  `OAuthPanel.tsx` already finishes that step.

## Non-goals

- No relay daemon, no second listener, no change to `resolve_callback_url()`
  for the providers that still use it (`claude`, `commandcode`).
- No dashboard rebuild, no new endpoint, no token-import change.

## Approaches considered

- **A. Loopback-pinned redirect (chosen).** `openai.rs` passes a caller-supplied
  `redirect_uri` through untouched and defaults to the vendor-registered
  `http://localhost:1455/auth/callback`. Same shape as `antigravity`, which
  already pins loopback because Google rejects anything else. Smallest diff,
  no new asset. Cost: the operator copies the `?code=...` URL from the failed
  `localhost:1455` tab into the paste box, which the panel already documents.
- **B. Local relay, like `commandcode`.** Ship a `codex-relay.mjs` that listens
  on `127.0.0.1:1455` and forwards `code`/`state` to the gateway. One-click UX,
  but a new script, a new route to serve it, and a terminal step for the
  operator. Rejected for now; it builds on A if A's paste step annoys in
  practice.
- **C. Token import only.** No code change; operator logs in with the official
  CLI elsewhere and posts `auth.json` to `/v1/auth/openai/token`. Rejected as
  the fix: the connect button would stay broken.

## How it gets built

- `features/providers/codex/types.rs`: add the registered redirect as a
  constant next to the other Codex OAuth constants.
- `features/provider_auth/openai.rs`: drop `resolve_callback_url` from the login
  path, default to that constant, and correct the `//!` header that claims the
  public origin rewrites the redirect.
- Tests: the login integration test in `server/tests/provider_auth.rs` pins the
  new default, plus a regression test that a configured `SROUTER_PUBLIC_URL`
  leaves a loopback `redirect_uri` alone.
- `features/provider_auth/claude.rs` keeps `resolve_callback_url`; its header
  comment currently says it rewrites "exactly like the OpenAI route" and must
  stop implying that.

## Left to the builder

- Whether the app-root `/auth/callback` page routes stay as they are (yes: they
  cost nothing and let a local port-forward finish the flow in the browser).
