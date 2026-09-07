# @srouter/pricing

Model pricing matrix and token cost estimation engine.

## Directory Layout

```text
packages/pricing/src/
├── pricing.ts         # Per-model pricing database (input cost, output cost, cache cost per 1M tokens)
├── matcher.ts         # Fuzzy & exact model ID matcher
├── parser.ts          # Token usage and cost accumulator
├── types.ts           # Pricing models and currency types
└── index.ts           # Barrel export
```

## Pricing Rules

1. **Standard Units**:
   - Rates are defined per 1,000,000 tokens (USD).
2. **Fallback Matching**:
   - If an exact model ID is not found (e.g. `gpt-4o-2024-08-06`), the matcher falls back to base model pricing (`gpt-4o`).
3. **Accuracy**:
   - Separate prompt tokens, completion tokens, and cache read/write tokens when computing total usage cost.
