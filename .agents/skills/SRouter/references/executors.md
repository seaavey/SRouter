# Provider Executors Reference — @srouter/executors

## Table of Contents
1. [Architecture](#architecture)
2. [Executor Interface](#executor-interface)
3. [Provider Implementations](#provider-implementations)
4. [Resiliency Primitives](#resiliency-primitives)
5. [Adding a New Provider](#adding-a-new-provider)

---

## Architecture

Each upstream AI provider has a dedicated executor in `packages/executors/src/`. Executors handle the actual HTTP communication, protocol translation, streaming, and response normalization.

```
packages/executors/src/
├── base.ts             # streamLines() and parseDataLine() SSE primitives
├── retry.ts            # fetchWithRetry() with exponential backoff
├── sse.ts              # SSE error extraction & capacity detection
├── search.ts           # Multi-provider web search fallback engine
├── openai.ts           # Standard OpenAI & Custom OpenAI-compatible
├── anthropic.ts        # Anthropic Claude (API key or OAuth)
├── antigravity.ts      # Google Antigravity/Gemini IDE envelope
├── codex.ts            # OpenAI Codex / ChatGPT Responses API
├── qoder.ts            # Qoder with WAF encoding & COSY signature
├── kiro.ts             # Amazon Q / Kiro binary EventStream protocol
├── codebuddy.ts        # CodeBuddy IDE streaming
├── commandcode.ts      # CommandCode NDJSON streaming
├── gorouter.ts         # GoRouter (OpenAI-compatible wrapper)
├── bluesminds.ts       # BluesMinds (OpenAI-compatible wrapper)
├── seekai.ts           # SeekAI (OpenAI-compatible wrapper)
├── tabitoken.ts        # TabiToken (OpenAI-compatible wrapper)
└── tokenrouter.ts      # TokenRouter (OpenAI-compatible wrapper)
```

---

## Executor Interface

All executors implement the `AIProvider` interface from `@srouter/types`:

```typescript
interface AIProvider {
    id: string;
    name: string;
    category?: ProviderCategory;
    protocol?: ProviderProtocol;
    listModels(): Promise<ModelObject[]>;
    chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk>;
    updateToken?(accessToken: string, refreshToken?: string): void;
}
```

Return type is `ExecutorResult` which standardizes response handling across providers.

---

## Provider Implementations

### Standard OpenAI (`OpenAIExecutor`)
- Protocol: OpenAI `/v1/chat/completions`
- Strips provider prefix from model names (`provider/model` → `model`)
- Dynamic model listing via `/models`
- Base class for all OpenAI-compatible wrappers

### Anthropic Claude (`AnthropicExecutor`)
- Auth: API key or OAuth token
- Injects dynamic `Anthropic-Beta` headers (`interleaved-thinking`, `token-efficient-tools`)
- Adds CLI spoof headers
- Translates between OpenAI format and `/v1/messages` via `@srouter/translator`

### Antigravity / Gemini (`AntigravityExecutor`)
- Auth: Google OAuth tokens (`ya29.*`) or API key
- Generates IDE envelope metadata (project, model, requestId, sessionId, userAgent)
- Sanitizes JSON schemas for Gemini compatibility (`cleanJSONSchemaForAntigravity`)
- Handles Gemini SSE token format and image generation endpoints

### OpenAI Codex (`CodexExecutor`)
- Auth: OpenAI OAuth token
- Connects to ChatGPT backend (`chatgpt.com/backend-api/codex/responses`)
- Injects default coding agent prompt
- Peels SSE chunks, handles reasoning encryption
- **Peek-first strategy**: reads first 256KB to catch upstream 200-OK transient capacity errors before committing to stream

### Qoder (`QoderExecutor`)
- Auth: OAuth device token or Personal Access Token (`pt-`)
- **WAF bypass**: Custom base64 transposition body encoding (`qoderEncodeBody`)
- **COSY signature**: AES-128-CBC session encryption, RSA-1024 public key encryption, MD5 signature
- PAT exchange for `jt-` tokens

### Kiro / Amazon Q (`KiroExecutor`)
- Auth: AWS Builder ID / IDC / Social login
- **Binary protocol**: AWS EventStream with 16-byte prelude, CRC32 verification, big-endian payload framing
- Tool execution state tracking
- Communicates with `runtime.us-east-1.kiro.dev`

### CodeBuddy (`CodeBuddyExecutor`)
- Auth: OAuth or Bearer token
- Connects to `www.codebuddy.ai/v2/chat/completions`
- Translates content to typed block arrays
- Enforces system persona `You are CodeBuddy Code.`

### CommandCode (`CommandCodeExecutor`)
- Auth: API key / Bearer
- Connects to `api.commandcode.ai/alpha/generate`
- **NDJSON streaming** (not SSE) — transforms to OpenAI chunk format
- Translates chat messages to memory/thread structures

### OpenAI-Compatible Wrappers
These inherit from `OpenAIExecutor` with preconfigured base URLs:

| Executor | Base URL |
|----------|----------|
| `GoRouterExecutor` | `https://gorouter.app` |
| `BluesMindsExecutor` | `https://api.bluesminds.com/v1` |
| `SeekAIExecutor` | `https://seekai.cc/v1` |
| `TabiTokenExecutor` | `https://tabitoken.com/v1` |
| `TokenRouterExecutor` | `https://api.tokenrouter.com/v1` |

---

## Resiliency Primitives

### Retry Logic (`retry.ts`)
`fetchWithRetry()` provides:
- Parses `Retry-After`, `x-ratelimit-reset-after`, `x-ratelimit-reset` headers
- Recognizes transient errors: `high traffic`, `overloaded`, `concurrency`, `capacity`, HTTP 500/502/503/504
- Exponential backoff with configurable caps

### Web Search Engine (`search.ts`)
High-availability search waterfall used for tool interception:
1. Tavily API (`api.tavily.com`)
2. Brave Search API (`api.search.brave.com`)
3. Serper Google Search (`google.serper.dev`)
4. SearXNG custom instance
5. Bing HTML scraping (zero-config, base64 URL decoding)
6. Wikipedia API fallback

### SSE Utilities (`sse.ts`)
- Error extraction from SSE streams
- Capacity/rate-limit detection
- Stream line parsing

---

## Adding a New Provider

### Simple (OpenAI-compatible)
If the upstream speaks standard OpenAI API:

```typescript
// packages/executors/src/myprovider.ts
import { OpenAIExecutor } from "./openai.js";

export class MyProviderExecutor extends OpenAIExecutor {
    constructor(apiKey: string) {
        super({
            id: "myprovider",
            name: "MyProvider",
            apiKey,
            baseUrl: "https://api.myprovider.com/v1",
        });
    }
}
```

### Complex (Custom protocol)
For providers with non-standard APIs:

1. Create `packages/executors/src/myprovider.ts`
2. Implement `AIProvider` interface
3. Handle request translation using `@srouter/translator` or custom logic
4. Handle streaming (SSE, NDJSON, WebSocket, etc.)
5. Normalize response to `ChatCompletionResponse` / `ChatCompletionChunk`
6. Add tests in `packages/executors/tests/`

### Then wire it up:
1. Export from `packages/executors/src/index.ts`
2. Add constants in `packages/constants/src/providers.ts` (base URL, model catalog)
3. Add seed in `packages/constants/src/seed.ts`
4. Register factory in `apps/api/src/logic/auth.providers.ts`
5. Add loading logic in `apps/api/src/services/registry.ts`
6. Add provider type to `@srouter/types`
