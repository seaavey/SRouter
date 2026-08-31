# @srouter/providers

Provider resilience management, circuit breakers, and OAuth provider integrations.

## Directory Layout

```text
packages/providers/src/
├── circuitBreaker.ts  # Circuit breaker state machine (Closed, Open, Half-Open)
├── registry.ts        # Dynamic provider registration and lookup
├── oauth/
│   ├── base.ts        # BaseOAuthProvider abstract class
│   ├── claude.ts      # Claude OAuth PKCE handler
│   ├── openai.ts      # OpenAI OAuth handler
│   ├── antigravity.ts # Antigravity OAuth handler
│   ├── codebuddy.ts   # CodeBuddy OAuth handler
│   ├── qoder.ts       # Qoder OAuth handler
│   └── index.ts       # OAuth registry
├── oauth.ts           # OAuth manager utilities
└── index.ts           # Barrel export
```

## Resilience Rules

1. **Circuit Breaker**:
   - Trips on consecutive 5xx or rate limit errors.
   - Prevents cascading gateway failure when an upstream provider goes down.
2. **OAuth Provider Implementations**:
   - Handle authorization URL generation, code exchange, token refresh, and storage decoupling.
