# Constants, Types & Pricing Reference — @srouter/constants, @srouter/types, @srouter/pricing

## Table of Contents

1. [Constants Package](#constants-package)
2. [Types Package](#types-package)
3. [Pricing Package](#pricing-package)

---

## Constants Package

`packages/constants/src/` — Single source of truth for provider metadata, URLs, model catalogs, and OAuth config.

### File Structure

```
packages/constants/src/
├── providers.ts    # Provider catalog, base URLs, model catalogs, helper functions
├── oauth.ts        # OAuth Client IDs, secrets, redirect URIs, endpoints
├── seed.ts         # Database seed definitions & SEED_MARKER
└── index.ts        # Barrel exports
```

### Provider Base URLs (`providers.ts`)

| Constant                   | URL                                     |
| -------------------------- | --------------------------------------- |
| `OPENAI_BASE_URL`          | `https://api.openai.com/v1`             |
| `ANTHROPIC_BASE_URL`       | `https://api.anthropic.com`             |
| `CODEX_BASE_URL`           | `https://chatgpt.com/backend-api/codex` |
| `ANTIGRAVITY_IDE_BASE_URL` | Google Cloud Code endpoint              |
| `NEOSANTARA_BASE_URL`      | Neosantara API                          |
| `GOROUTER_BASE_URL`        | `https://gorouter.app`                  |
| `BLUESMINDS_BASE_URL`      | `https://api.bluesminds.com/v1`         |
| `SEEKAI_BASE_URL`          | `https://seekai.cc/v1`                  |
| `TABITOKEN_BASE_URL`       | `https://tabitoken.com/v1`              |
| `TOKENROUTER_BASE_URL`     | `https://api.tokenrouter.com/v1`        |
| `COMMANDCODE_BASE_URL`     | `https://api.commandcode.ai`            |
| `CODEBUDDY_BASE_URL`       | `https://www.codebuddy.ai`              |
| `QODER_CHAT_BASE`          | Qoder API endpoint                      |

### Known Provider Catalog (`KNOWN_PROVIDERS`)

Single source of truth for 13 built-in providers: `kiro`, `neosantara`, `gorouter`, `bluesminds`, `seekai`, `tabitoken`, `tokenrouter`, `openai_codex`, `anthropic`, `antigravity`, `commandcode`, `qoder`, `codebuddy`.

**Helper functions:**

- `providerById(id)` — Lookup provider definition
- `isKnownProvider(id)` — Check if ID is a built-in provider
- `providerBaseId(id)` — Get base provider type from a connection ID
- `isProviderBaseId(id)` — Check if ID is a base provider ID
- `providerAlias(id)` — Get short alias for a provider
- `providerTypeForAlias(alias)` — Reverse lookup: alias → provider type
- `getProviderWebsiteUrl(id)` — Get provider's console/website URL

### Model Catalogs

**`CODEBUDDY_MODELS`** — 29 model definitions:
GPT-5.5, GPT-5.4, Gemini 3.1 Pro, DeepSeek-V4-Pro, GLM-5.2, Kimi-K2.7, MiniMax-M3, etc.

**`ANTIGRAVITY_MODELS`** — 14 model definitions:
Gemini 3.7 Flash (High/Med/Low), Gemini 3.6 Flash, Claude Sonnet 4.6 Thinking, Claude Opus 4.6 Thinking, GPT-OSS 120B, etc.

Each model entry includes: `id`, `name`, `created`, `object`, and optionally `capabilities` (vision 👁️, reasoning 🧠).

### OAuth Config (`oauth.ts`)

- **OpenAI Codex**: Client ID `app_EMoamEEZ73f0CkXaXp7hrann`, scopes, authorize/token endpoints
- **Antigravity**: Google OAuth client ID `1071006060591-...`, client secret, endpoints
- **Qoder RSA public key**: 1024-bit RSA key for COSY encryption (`QODER_RSA_PUBLIC_KEY`)

### Database Seeds (`seed.ts`)

- `DEFAULT_PROVIDERS` — Array of seed definitions for SQLite initialization
- `SEED_MARKER = "__seed__"` — Marker to distinguish unconfigured seed rows from real connections
- `isSeedProvider(p)` — Check if a provider row is a seed entry

---

## Types Package

`packages/types/src/` — All TypeScript interfaces, domain models, and Zod validation schemas.

### File Structure

```
packages/types/src/
├── openai.ts       # OpenAI Chat Completion types
├── anthropic.ts    # Anthropic Messages API types
├── provider.ts     # Provider & executor interfaces
├── apiKeys.ts      # DBAPIKey interface
├── fallbacks.ts    # FallbackRule interface & Zod schemas
├── logs.ts         # Request log & usage summary types
├── quota.ts        # Quota response types
├── schemas.ts      # Zod validation schemas for requests
├── tokenSaver.ts   # Token saver settings & schemas
└── index.ts        # Barrel exports
```

### Core Interfaces

#### `AIProvider` (`provider.ts`)

The main interface every executor must implement:

```typescript
interface AIProvider {
    id: string;
    name: string;
    category?: ProviderCategory; // "oauth" | "api_key" | "custom" | "free_tier"
    protocol?: ProviderProtocol; // "openai" | "anthropic" | "custom"
    listModels(): Promise<ModelObject[]>;
    chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk>;
}
```

#### `ProviderConfig` (`provider.ts`)

Database row shape for the `providers` table:

```typescript
interface ProviderConfig {
    id: string;
    providerId: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    accountId?: string;
    organizationId?: string;
    providerSpecificData?: string; // JSON
    tokenExpiresAt?: number;
    lastRefreshedAt?: number;
    customHeaders?: string; // JSON
    enabled: boolean;
    createdAt: string;
}
```

### OpenAI Types (`openai.ts`)

- `ChatMessage` — role + content + tool_calls
- `ToolCall`, `ToolDefinition`, `ToolChoiceOption`
- `ChatCompletionRequest` — model, messages, tools, stream, temperature, etc.
- `ChatCompletionResponse` — id, choices, usage
- `ChatCompletionChunk` / `ChatCompletionChunkDelta` — streaming types
- `UsageInfo` — with `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`

### Anthropic Types (`anthropic.ts`)

- `AnthropicContentBlock` — `text`, `image`, `tool_use`, `tool_result`, `thinking`, `redacted_thinking`
- `AnthropicMessageRequest` / `AnthropicMessageResponse`
- `AnthropicStreamEvent` — all SSE event types

### Zod Schemas (`schemas.ts`)

Runtime validation schemas (used by API middleware):

- `ChatCompletionRequestSchema` — validates incoming chat requests
- `ChatMessageSchema` — validates message structure
- `ToolDefinitionSchema` — validates tool definitions
- `CreateAPIKeySchema` — validates key creation requests
- `CreateProviderSchema` — validates provider creation
- `FallbackRuleSchema` / `UpdateFallbackRuleSchema`
- `TokenSaverSettingsSchema`, `CompressToolOutputSchema`, `LazySeniorDevSchema`, `CompressLlmOutputSchema`

### Other Types

- `DBAPIKey` (`apiKeys.ts`) — Virtual API key database row
- `FallbackRule` (`fallbacks.ts`) — Fallback routing rule
- `RequestLogEntry`, `UsageSummary`, `UsageByModelRow` (`logs.ts`) — Audit log entries
- `LiveModelQuotaItem`, `ProviderQuotaAccount`, `QuotaResponse` (`quota.ts`) — Quota data
- `TokenSaverSettings` (`tokenSaver.ts`) — Token saver configuration

---

## Pricing Package

`packages/pricing/` — Token cost estimation engine with JSONC pricing data.

### File Structure

```
packages/pricing/
├── data/
│   └── pricing.jsonc       # Model pricing dataset (with comments)
├── src/
│   ├── parser.ts           # JSONC parser, comment stripper, dataset resolver
│   ├── matcher.ts          # Model name normalization & canonical key resolution
│   ├── pricing.ts          # Cost calculation engine & catalog
│   ├── types.ts            # ModelPrice, PricingDataset, ProviderModelMap interfaces
│   └── index.ts            # Package exports
└── tests/
    └── pricing.test.ts
```

### JSONC Parser (`parser.ts`)

- `stripJsonComments()` — Removes `//` and `/* */` comments and trailing commas
- `loadPricingData()` — Locates `pricing.jsonc` across multiple candidate directories, flattens provider arrays into lookup map

### Model Name Matcher (`matcher.ts`)

`normalizeModelName()` pipeline:

1. Strip tags: `:free`, `:latest`, `:online`
2. Strip provider namespaces: `commandcode/deepseek/deepseek-v4-flash` → `deepseek-v4-flash`
3. Resolve aliases case-insensitively: `claude-3.5-sonnet` → `claude-3-5-sonnet-20241022`

`findCanonicalModelKey()` — Four-stage lookup:

1. Exact raw match
2. Normalized match
3. Case-insensitive normalized match
4. Base name match

### Cost Calculation Engine (`pricing.ts`)

```typescript
calculateCostFromTokens(tokens: TokenBreakdown, pricing: ModelPrice): number
```

Formula:

```
nonCachedInput = max(0, inputTokens - cachedTokens - cacheCreationTokens)

cost = (nonCachedInput × priceIn
      + cachedTokens × priceCache
      + outputTokens × priceOut
      + reasoningTokens × priceReason
      + cacheCreationTokens × priceCreate) / 1,000,000
```

Prompt tokens are treated as cache-inclusive — cached and cache creation tokens are subtracted so they aren't billed twice.

### Pricing Data Format (`pricing.jsonc`)

```jsonc
{
    "anthropic": [
        {
            "model": "claude-3-5-sonnet-20241022",
            "aliases": ["claude-3.5-sonnet", "claude-3-5-sonnet"],
            "input": 3.0, // per 1M tokens
            "output": 15.0,
            "cached_input": 0.3,
            "cache_creation": 3.75,
            "reasoning_output": 15.0
        }
    ]
}
```

### Adding Pricing for a New Model

1. Edit `packages/pricing/data/pricing.jsonc`
2. Add entry under the provider key with `model`, `input`, `output`, and optional `cached_input`, `cache_creation`, `reasoning_output`, `aliases`
3. Run `pnpm test --filter @srouter/pricing` to verify
