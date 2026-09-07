# Authentication & Security

## ApiKeyAuth

Behavior:

- accepts `Authorization` bearer token
- accepts `x-api-key`
- virtual keys use `sr-live-*`
- respects `require_api_key`
- loopback can bypass auth when disabled

Remote/public requests should never bypass API key validation.

## RequireAdmin

Admin auth:

- session-cookie based
- cookie: `srouter_admin_session`
- password hashing via scrypt
- remote bootstrap gated by `SROUTER_SETUP_TOKEN`

Mutation endpoints should default to `RequireAdmin`.

## SSRF Protection

Provider validation blocks:

- `127.*`
- `localhost`
- `169.254.*`
- metadata/internal hosts

## OAuth Patterns

Controller structure:

```ts
AuthController.<Provider>.OAuth
AuthController.<Provider>.Callback
AuthController.<Provider>.Poll
AuthController.<Provider>.ImportToken
```

Callback naming:

```text
<Provider>OAuthCallback
```

Examples:

- `ClaudeOAuthCallback`
- `CodexOAuthCallback`
- `AntigravityOAuthCallback`
