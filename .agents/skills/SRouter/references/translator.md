# Translation Layer Reference — @srouter/translator

## Table of Contents
1. [Architecture](#architecture)
2. [OpenAI ↔ Anthropic Translation](#openai--anthropic-translation)
3. [OpenAI ↔ Codex/Responses API](#openai--codexresponses-api)
4. [OpenAI ↔ Gemini/Antigravity](#openai--geminiantigravity)
5. [Token Saver System](#token-saver-system)
6. [Usage & Cost Normalization](#usage--cost-normalization)

---

## Architecture

`@srouter/translator` handles bidirectional protocol conversion so that SRouter can accept requests in one format and forward them to providers that speak a different protocol.

```
packages/translator/src/
├── adapter.ts        # Generic OpenAI ↔ Anthropic request/response conversion
├── anthropic.ts      # Full Anthropic ↔ OpenAI SSE streams & tools
├── responses.ts      # OpenAI Chat ↔ Responses API (Codex format)
├── gemini.ts         # OpenAI ↔ Gemini/Antigravity content blocks & SSE
├── commandcode.ts    # OpenAI ↔ CommandCode NDJSON events
├── tokenSaver.ts     # Prompt compression & system prompt injection
├── usage.ts          # Token usage normalization & cost estimation
└── index.ts          # Barrel exports
```

---

## OpenAI ↔ Anthropic Translation

Two-way conversion between OpenAI Chat Completions and Anthropic Messages API.

### Request Translation

**`anthropicToOpenAIRequest`** / **`openAIToAnthropicRequest`**:
- System prompts: Anthropic `system` field ↔ OpenAI `role: "system"` messages
- Multimodal: Base64 image blocks converted between formats
- Tool use: Anthropic `tool_use` content blocks ↔ OpenAI `tool_calls` array
- Tool results: Anthropic `tool_result` blocks ↔ OpenAI `role: "tool"` messages
- Tool schemas: `input_schema` ↔ function `parameters`

### Response & Stream Translation

**`openAIToAnthropicResponse`** / **`openAIToAnthropicStream`**:
- Transforms OpenAI chunks into Anthropic SSE events:
  - `message_start`, `content_block_start`, `content_block_delta`
  - `content_block_stop`, `message_delta`, `message_stop`
- Separates `reasoning_content` into Anthropic `thinking` content blocks
- Maps tool call streaming into `input_json_delta`

---

## OpenAI ↔ Codex/Responses API

Conversion for ChatGPT backend / OpenAI Codex which uses the Responses API format.

### `chatToResponsesBody(req)`
- System messages → `role: "developer"` or top-level `instructions`
- Assistant `tool_calls` → `type: "function_call"`
- Tool results → `type: "function_call_output"`
- Normalizes `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`)
- Filters through strict `RESPONSES_BODY_ALLOWLIST`

### `responsesEventToChunk(eventType, data, state)`
Maps Responses SSE events to OpenAI chunks:
- `response.output_text.delta` → text delta
- `response.output_item.added` → content block
- `response.function_call_arguments.delta` → tool call args
- `response.done` → finish reason

---

## OpenAI ↔ Gemini/Antigravity

### `buildAntigravityContents(req)`
Maps messages to Gemini format: `{ role: "user" | "model", parts: [...] }`

### `cleanJSONSchemaForAntigravity(schema)`
Recursively purges unsupported JSON schema keywords for Gemini compatibility:
- Removes: `minLength`, `pattern`, `additionalProperties`, `anyOf`, `allOf`, `default`, `$defs`
- Converts `const` → `enum`
- Flattens type arrays
- Ensures objects have properties

### `geminiStreamToOpenAIChunks(chunk, state)`
Parses Gemini response format:
- Handles `thought` / `thoughtSignature` reasoning blocks
- Inline image data
- Function calls → OpenAI tool_calls

---

## Token Saver System

Multi-stage prompt compression in `tokenSaver.ts`:

### Tool Output Compression
- `compressGitDiff()` — Strips index hashes, mode changes, compresses diff headers (`@@ L10 @@`)
- `compressGitStatusOrLog()` — Compresses git commit blocks and status boilerplate
- `compressGrepOutput()` — Groups multi-line matches under single file headers
- `compressFileListings()` — Strips permissions, ownership, sizes from `ls -la` and `tree`
- `compressGenericLogs()` — Collapses duplicate log lines (`↳ [repeated N more times]`)
- `stripAnsiCodes()` — Removes ANSI color/control escape sequences

### System Prompt Injection
- **Lazy Senior Dev (ponytail mode)**: Injects YAGNI instructions, stdlib reuse rules, surgical edit requirements
- **Caveman Mode (terse output)**: Strips pleasantries and filler for ~80% token reduction

### Integration
Token Saver is applied in the chat execution pipeline *before* the request reaches the provider executor. Settings are persisted in `@srouter/db` system_settings.

---

## Usage & Cost Normalization

### `extractUsageBreakdown(provider, usage)`
Normalizes provider-specific token fields into a standard structure:
```typescript
{
    promptTokens: number,
    completionTokens: number,
    cachedTokens: number,
    cacheCreationTokens: number,
    reasoningTokens: number,
    totalTokens: number
}
```

### `estimateCostForUsage(provider, model, breakdown)`
Uses `@srouter/pricing` to compute dollar costs:

$$\text{nonCachedInput} = \max(0, \text{inputTokens} - \text{cachedTokens} - \text{cacheCreationTokens})$$

$$\text{Cost} = \frac{\text{nonCachedInput} \times P_{\text{in}} + \text{cachedTokens} \times P_{\text{cache}} + \text{outputTokens} \times P_{\text{out}} + \text{reasoningTokens} \times P_{\text{reason}} + \text{cacheCreationTokens} \times P_{\text{create}}}{1{,}000{,}000}$$

The pricing data lives in `packages/pricing/data/pricing.jsonc` — a JSONC file with model-level pricing, aliases, and cached token rates.

### Model Name Resolution (`packages/pricing/src/matcher.ts`)
Four-stage lookup:
1. Exact raw match
2. Normalized match (strip tags, namespaces)
3. Case-insensitive normalized
4. Base name match

Normalization strips: `:free`, `:latest`, `:online` tags and provider namespace prefixes.
