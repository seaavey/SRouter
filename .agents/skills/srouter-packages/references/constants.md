# @srouter/constants

Centralized home for version strings, model lists, and provider catalog metadata.

## Directory Layout

```text
packages/constants/src/
├── version.ts         # GLOBAL_VERSION, APP_VERSION, API_VERSION, CLI_VERSION
├── providers/
│   ├── anthropic.ts   # Anthropic provider metadata & model list
│   ├── antigravity.ts # Antigravity provider metadata & model list
│   ├── openai.ts      # OpenAI provider metadata & model list
│   ├── opencode.ts    # OpenCode provider metadata
│   ├── catalog.ts     # KNOWN_PROVIDERS catalog registry
│   ├── categories.ts  # Model categories and tags
│   └── types.ts       # Provider metadata type definitions
├── seed.ts            # Default seed configuration
└── index.ts           # Barrel export
```

## Constants Rules

1. **Single Source of Truth**:
   - Hardcoded model names, provider IDs, or version strings anywhere in `apps/*` or other packages is a bug. Import them from `@srouter/constants`.
2. **Adding a New Provider**:
   - Create `packages/constants/src/providers/<provider>.ts`.
   - Register it in `packages/constants/src/providers/catalog.ts` under `KNOWN_PROVIDERS`.
3. **Releases**:
   - Version bumps take place in `version.ts` alongside package.json files in a release commit.
