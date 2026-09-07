# @srouter/executors

Upstream provider drivers and HTTP execution engines that abstract vendor-specific protocols.

## Directory Layout

```text
packages/executors/src/
├── base.ts            # BaseExecutor abstract class
├── openai.ts          # Standard OpenAI driver
├── anthropic.ts       # Anthropic Messages protocol driver
├── antigravity.ts     # Antigravity engine driver
├── codex.ts           # OpenAI Codex driver
├── codebuddy.ts       # CodeBuddy driver
├── commandcode.ts     # CommandCode driver
├── gorouter.ts        # GoRouter driver
├── kiro.ts            # Kiro driver
├── seekai.ts          # SeekAI driver
├── qoder.ts           # Qoder driver
├── bai.ts             # Bai driver
├── tabitoken.ts       # TabiToken driver
├── tokenrouter.ts     # TokenRouter driver
├── sse.ts             # SSE frame parser and emitter utilities
├── retry.ts           # Exponential backoff and retry logic
├── stream-utils.ts    # Stream multiplexing and chunk handling
└── index.ts           # Driver registry and factory methods
```

## Executor Rules

1. **Extends `BaseExecutor`**:
   - All provider drivers must inherit from `BaseExecutor` and implement `execute()` and `stream()`.
2. **SSE Framing**:
   - Use shared SSE frame builders (`sse.ts`) for streaming chunks: `data: {...}

` followed by `data: [DONE]

`.
3. **Upstream Error Normalization**:
   - Catch provider-specific HTTP errors (401, 429, 500, 503) and normalize them into standard error payloads.
4. **Isolate Upstream Quirks**:
   - Keep vendor-specific headers, URL query parameters, and auth headers encapsulated within that provider's executor class.
