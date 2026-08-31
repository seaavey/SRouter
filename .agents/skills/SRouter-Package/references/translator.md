# @srouter/translator

Pure translation engine converting payloads and stream chunks between API dialects (OpenAI ↔ Anthropic).

## Directory Layout

```text
packages/translator/src/
├── anthropic.ts       # OpenAI ChatRequest ↔ Anthropic Messages transformer
├── antigravity.ts     # Antigravity JSON schema cleaner and sanitizer
├── adapter.ts         # Generic dialect adapter helpers
├── commandcode.ts     # CommandCode protocol mapping
├── responses.ts       # Non-streaming response converters
├── tokenSaver.ts      # Prompt compression and token savings calculator
├── usage.ts           # Token usage and billing extractor from chunks
└── index.ts           # Barrel export
```

## Translation Laws

1. **Absolute Purity**:
   - No side effects: forbidden from using `fetch`, `node:fs`, `process.env`, `setTimeout`, or `Date.now()`.
   - Given the same input, translator functions must always produce the identical output.
2. **Schema Sanitization**:
   - `cleanJSONSchemaForAntigravity()` strips unsupported JSON schema keywords (`$schema`, `additionalProperties` quirks) before forwarding to strict engines.
3. **Dialect Integrity**:
   - Never lose message context, role transitions (`system`, `user`, `assistant`, `tool`), or tool call IDs during cross-dialect conversion.
