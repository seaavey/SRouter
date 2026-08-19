# Provider Registry & Circuit Breaker Reference — @srouter/providers

## Table of Contents
1. [Architecture](#architecture)
2. [ProviderRegistry](#providerregistry)
3. [Model Resolution Pipeline](#model-resolution-pipeline)
4. [Circuit Breaker](#circuit-breaker)
5. [OAuth PKCE Handlers](#oauth-pkce-handlers)

---

## Architecture

`@srouter/providers` is the runtime coordinator that manages live provider instances, discovers models, routes requests to healthy candidates, and handles OAuth state.

```
packages/providers/src/
├── registry.ts          # ProviderRegistry: model discovery, cache, candidate resolution
├── circuitBreaker.ts    # Health tracking, cooldown timers, exponential backoff
├── oauth/
│   ├── base.ts          # PKCE generator (code_verifier, code_challenge S256) & interfaces
│   ├── openai.ts        # OpenAI Codex OAuth 2.0 PKCE flow
│   ├── antigravity.ts   # Google Antigravity OAuth 2.0 PKCE flow
│   ├── claude.ts        # Anthropic Claude Code OAuth 2.0 PKCE flow
│   ├── qoder.ts         # Qoder device auth & token polling
│   ├── codebuddy.ts     # CodeBuddy state/polling auth
│   └── index.ts         # OAuth barrel exports
├── oauth.ts             # Re-export of OAuth providers
└── index.ts             # Package exports
```

---

## ProviderRegistry

The registry is the central runtime coordinator. It holds all active provider executor instances and handles model discovery + request routing.

### Model Discovery & Caching

- **In-flight promise coalescing** — `modelsInflight` map prevents dog-piling when concurrent requests hit unprimed caches
- **Concurrency-controlled refresh** — Worker pool with `MODEL_REFRESH_CONCURRENCY = 4` limits parallel upstream model listing calls
- **Failure cooldown** — `MODEL_FAILURE_COOLDOWN_MS = 30s` prevents hammering dead upstream connections
- **Snapshot TTL** — 5-minute cache with background non-blocking revalidation

### Key Methods

```typescript
// Register a live provider executor
registry.register(executor: AIProvider): void

// Remove a provider
registry.unregister(id: string): void

// Refresh all model catalogs from upstream
registry.refreshModels(): Promise<void>

// Get all available models across providers
registry.listModels(): ModelObject[]

// Find candidate providers for a model (ordered by health)
registry.getCandidateProvidersForModel(model: string): AIProvider[]

// Execute chat completion with automatic failover
registry.chatCompletion(req): Promise<ChatCompletionResponse>
registry.chatCompletionStream(req): AsyncGenerator<ChatCompletionChunk>
```

---

## Model Resolution Pipeline

When a request comes in for a model like `anthropic/claude-3-7-sonnet`, the registry resolves it through this pipeline:

### `getCandidateProvidersForModel(model)`

1. **Direct Match** — Exact lookup of `alias/model` or `providerId/model` or bare `model` against cached dynamic model catalogs of all registered executors

2. **Prefix Matching** — If not found in catalogs, resolves provider prefix:
   - `openai/gpt-4o` → find OpenAI executor
   - `qd/deepseek-v3` → find Qoder executor via alias
   - `claude/claude-3-5-sonnet` → find Anthropic executor via alias

3. **Circuit-Breaker Ordering** — Sorts candidate providers by health:
   - Healthy accounts first
   - Round-robin among healthy candidates
   - Cooldown/exhausted accounts pushed to end

### Failover Execution

```
chatCompletion(req) / chatCompletionStream(req):
  for each candidate in getCandidateProvidersForModel(model):
    try:
      result = candidate.execute(req)
      circuitBreaker.recordSuccess(candidate.id)
      return result
    catch:
      circuitBreaker.recordError(candidate.id, error)
      if streaming && tokens already yielded:
        abort  // can't retry mid-stream without corrupting output
      continue to next candidate
  throw "all candidates exhausted"
```

The key constraint: if streaming has already yielded tokens to the client, failover aborts immediately to prevent duplicate/corrupted output.

---

## Circuit Breaker

`circuitBreaker.ts` tracks per-account health and manages automatic rotation.

### States

| State | Meaning |
|-------|---------|
| `healthy` | Account is operational, can receive requests |
| `cooldown` | Recently failed, waiting for backoff timer to expire |
| `exhausted` | Rate limited or quota depleted, longer cooldown |

### Error Recognition

Detects rate-limit & quota errors from:
- HTTP 429 status
- Response body keywords: `quota exhausted`, `capacity`, `high traffic`, `rate limit`

### Exponential Backoff

$$\text{cooldown} = \min(\text{defaultCooldown} \times 2^{\text{failures}-1},\ 300{,}000\text{ms})$$

Maximum cooldown: 5 minutes. After cooldown expires, account returns to `healthy`.

### Multi-Account Rotation

In setups with multiple accounts per provider (e.g. 5 ChatGPT accounts), the circuit breaker automatically rotates away from rate-limited accounts while their cooldowns expire. Healthy accounts continue serving requests uninterrupted.

---

## OAuth PKCE Handlers

### Base PKCE Generator (`oauth/base.ts`)

```typescript
generatePKCE(): {
    codeVerifier: string,   // 32-byte base64url random
    codeChallenge: string,  // SHA-256 of verifier, base64url encoded
    state: string           // 16-byte random state token
}
```

### Provider-Specific OAuth Clients

| Class | Provider | Client ID | Key Features |
|-------|----------|-----------|--------------|
| `OpenAICodexOAuth` | OpenAI Codex | `app_EMoamEEZ73f0CkXaXp7hrann` | Extracts `chatgpt_account_id` from token response or id_token JWT |
| `AntigravityOAuth` | Google Antigravity | `1071006060591-...` | Google Cloud Platform PKCE with offline consent |
| `ClaudeOAuth` | Claude Code | `9d1c250a-e61b-...` | JSON payload token exchange (not form-encoded) |
| `QoderOAuth` | Qoder | Device flow | Device authorization code challenge + poll |
| `CodeBuddyOAuth` | CodeBuddy | Plugin auth | State acquisition + token polling (`/v2/plugin/auth/*`) |

### Common OAuth Flow

```typescript
const oauth = new OpenAICodexOAuth();

// 1. Generate auth URL
const { url, codeVerifier, state } = oauth.getAuthorizationUrl(redirectUri);

// 2. User authorizes in browser...

// 3. Exchange code for tokens
const tokens = await oauth.exchangeCode(code, codeVerifier, redirectUri);
// → { accessToken, refreshToken, expiresIn, accountId }

// 4. Refresh when expiring
const newTokens = await oauth.refreshTokens(refreshToken);
```
