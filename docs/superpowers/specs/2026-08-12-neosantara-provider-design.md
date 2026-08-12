# Neosantara Provider Design

**Date:** 2026-08-12
**Status:** Approved design; implementation has not started

## Goal

Add Neosantara as a first-class SRouter provider for the Neosantara API-key OpenAI-compatible API, supporting live model discovery, Chat Completions, SSE streaming, and tool calls without adding a new wire protocol.

## Scope

### Included

- Provider catalog entry with ID `neosantara`.
- API-key authentication using `Authorization: Bearer <key>`.
- Default API base URL `https://api.neosantara.xyz/v1`.
- Optional environment configuration through `NEOSANTARA_API_KEY` and `NEOSANTARA_BASE_URL`.
- Live model discovery through `GET /models`.
- Non-streaming `POST /chat/completions`.
- Streaming `POST /chat/completions` with SSE.
- OpenAI-compatible tool definitions and tool-call chunks passed through unchanged.
- Saved-provider startup loading with an explicit Neosantara case before generic OpenAI fallbacks.
- Model IDs using the `neosantara/<model-id>` SRouter prefix, with only that provider prefix removed before the upstream request.

### Excluded

- Responses API.
- Embeddings, image generation, audio, video, OCR, and other specialized endpoints.
- Neosantara Coding Plan authentication or coding-agent endpoints.
- OAuth, JWT, automatic key rotation, or a custom Neosantara executor.
- A static fabricated model catalog used as a substitute for failed live discovery.

## External API contract

The official Neosantara documentation describes an OpenAI-compatible API at `https://api.neosantara.xyz/v1`:

- Authentication: `Authorization: Bearer <NEOSANTARA_API_KEY>`.
- Models: `GET /v1/models`.
- Chat: `POST /v1/chat/completions`.
- Streaming: the normal OpenAI `stream: true` SSE contract.
- Tools: OpenAI-compatible function definitions and tool calls.

References:

- [Neosantara authentication](https://docs.neosantara.xyz/en/authentication)
- [Neosantara OpenAI-compatible API](https://docs.neosantara.xyz/en/sdk/openai-compat/index)
- [Neosantara Chat Completions](https://docs.neosantara.xyz/en/sdk/openai-compat/chat-completions)
- [Neosantara tool calls](https://docs.neosantara.xyz/en/sdk/openai-compat/tool-calls)
- [Neosantara models overview](https://docs.neosantara.xyz/en/models-overview)

## Architecture

Neosantara will use the existing `OpenAIExecutor` rather than duplicating an executor. The provider is protocol-compatible, so the integration adds provider identity, defaults, and explicit startup wiring while reusing the tested request, response, and SSE behavior.

### Catalog

Add one `ProviderDefinition` to `packages/providers/src/registry.ts`:

- `id`: `neosantara`
- `name`: `Neosantara`
- `category`: `api_key`
- `protocol`: `openai`
- `defaultBaseUrl`: `https://api.neosantara.xyz/v1`
- `requiresApiKey`: `true`
- `supportsCustomUrl`: `true`
- disconnected status when no connection is registered
- no hard-coded model list; live models come from the upstream `/models` endpoint

Add `neosantara: "neosantara"` to the provider alias map so model routing understands both `neosantara/<model>` and saved connection IDs such as `neosantara_<suffix>`.

### Environment startup

In `apps/api/src/services/registry.ts`, register an environment-configured `OpenAIExecutor` when `NEOSANTARA_API_KEY` is present:

```ts
new OpenAIExecutor({
    id: "neosantara",
    name: "Neosantara",
    apiKey: process.env.NEOSANTARA_API_KEY,
    baseUrl: process.env.NEOSANTARA_BASE_URL || "https://api.neosantara.xyz/v1",
})
```

This must be placed alongside the existing environment provider registrations and must not expose the key in catalog responses or logs.

### Saved connections

In `loadSavedProvidersFromDB()`, add an explicit Neosantara branch before generic `p.protocol === "openai"` handling. It must use the saved `baseUrl` when present and otherwise use `NEOSANTARA_BASE_URL` or the official default. It must pass the saved API key/access token through the existing `OpenAIExecutor` credential fields.

The explicit branch prevents Neosantara connections from being silently treated as an arbitrary OpenAI provider and preserves the provider-specific default URL.

### Model routing and prefix handling

The registry alias must map `neosantara` to itself. The generic executor must strip only the first provider prefix when routing a request:

- `neosantara/garda-core` → upstream model `garda-core`.
- `neosantara/provider/model-with-slash` → upstream model `provider/model-with-slash`.
- `garda-core` remains `garda-core` when no prefix is present.

No suffix or model-internal slash may be removed.

### Runtime behavior

- `listModels()` calls the configured `/models` endpoint and returns the upstream model objects under the Neosantara provider namespace, following existing OpenAI executor behavior.
- `chatCompletion()` calls `/chat/completions` with `stream: false` and the selected bare model.
- `chatCompletionStream()` calls `/chat/completions` with `stream: true` and parses standard SSE through the existing `streamLines`/`parseDataLine` helpers.
- Tool definitions are included in the request unchanged according to the existing OpenAI request type.
- Tool-call deltas are yielded unchanged according to the existing OpenAI chunk type.
- Non-2xx responses include HTTP status and upstream error text without printing credentials.
- Missing or failed model discovery returns an empty model list rather than fabricated models.

## Files and responsibilities

Expected implementation files:

- Modify `packages/providers/src/registry.ts`: alias and catalog metadata.
- Modify `apps/api/src/services/registry.ts`: environment registration and saved-provider branch.
- Modify or add focused tests beside the existing provider/executor tests: catalog metadata, routing, auth, model listing, chat body, streaming, and tools.
- Modify `pnpm-lock.yaml` only if a new test/runtime dependency is genuinely required; reuse existing tooling where possible.

No database schema change is expected because existing provider fields already persist the API key, base URL, category, protocol, and enabled state.

## Error handling and security

- Never include API keys in response bodies, catalog data, logs, test output, or committed fixtures.
- Use the existing `OpenAIExecutor` bearer-header behavior; do not add alternate authentication guesses.
- Preserve custom base URLs for compatible proxies, but default new Neosantara connections to the official URL.
- Treat upstream model-list failures as an unavailable live connection, not proof that no models exist permanently.
- Do not add a static list of Neosantara models that can become stale.

## Testing strategy

Focused tests must prove:

1. Catalog metadata identifies Neosantara as an API-key OpenAI provider and uses the official default URL.
2. Alias routing recognizes `neosantara/garda-core`.
3. A saved Neosantara connection receives the correct default URL and is loaded by the explicit branch.
4. Requests use `Authorization: Bearer <redacted test token>` and never emit the token in errors or output.
5. `/models` response models are returned with the Neosantara namespace.
6. Non-streaming chat sends the bare model and `stream: false`.
7. Streaming chat sends `stream: true` and yields parsed SSE chunks.
8. Tool definitions survive request serialization and tool-call chunks survive response parsing.
9. A nested model ID preserves its internal slash after only the `neosantara/` prefix is stripped.
10. Non-2xx upstream responses produce the existing executor error shape.

Validation commands after implementation:

```bash
pnpm --filter @srouter/types build
pnpm --filter @srouter/db build
pnpm --filter @srouter/providers build
pnpm --filter @srouter/pricing build
pnpm --filter @srouter/translator build
pnpm --filter @srouter/executors build
pnpm --filter api exec tsc --noEmit
pnpm --filter @srouter/providers test
pnpm --filter @srouter/executors test
pnpm --filter api test
pnpm --filter web build
git diff --check
```

A live API smoke test is optional and requires a user-provided Neosantara API key. If performed, the key must be supplied through the environment and must never be printed or committed.

## Acceptance criteria

The provider is ready for implementation review when:

- Neosantara appears in the provider catalog with the official default URL.
- Environment and saved connections use `OpenAIExecutor` with the correct Neosantara defaults.
- Model discovery, chat, streaming, and tools are covered by deterministic mocks.
- Provider prefixes are stripped exactly without damaging nested model IDs.
- All relevant builds, typechecks, tests, web build, and diff checks pass.
- No credential or unrelated generated artifact appears in the diff.

## Design decisions

- Dedicated thin integration over a duplicated executor: the upstream wire protocol is already OpenAI-compatible.
- API-key API only: Coding Plan is a separate product with separate scope and authentication.
- Dynamic model discovery over static models: avoids stale model IDs.
- Explicit loader branch: guarantees the official Neosantara default URL and provider identity.
- No database migration: current provider persistence is sufficient.
