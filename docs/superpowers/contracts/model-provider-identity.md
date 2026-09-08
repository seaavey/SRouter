# SRouter Model and Provider Identity Contract

Status: Proposed for reliability hardening

This contract defines the identity forms used while routing a model request. It is intentionally separate from the public API wire contract: no new request or response fields are introduced.

## Identity forms

| Stage | Canonical form | Owner / behavior |
| --- | --- | --- |
| Public model input | `alias/model-name` | Chat and image routes accept the external model ID. Bare model input remains compatible when a provider can resolve it. |
| Registry lookup | Prefixed, bare, or provider-account form | `ProviderRegistry` matches the exact listed model, strips a recognized alias/account/base prefix, then tries provider-prefix matching. |
| Executor model | Bare `model-name` | Provider executors receive the provider-specific model name after their existing provider mapping. |
| Provider account ID | `provider_<account-suffix>` | Runtime connection identity. Account suffixes must not become the provider identity in logs or pricing. |
| Custom provider ID | UUID | A custom UUID is immutable and is its own base identity. Its configured alias is the model namespace. |
| Request-log provider ID | Canonical base provider ID | Account IDs collapse through `providerBaseId`; legacy aliases resolve through `providerTypeForAlias`. |
| Token-refresh lookup | Registered provider/account alias | Refresh operates on the provider identity used by the live registry and saved provider connection. |
| Seed provider row | Catalog/base provider ID with seed marker | Seed rows fill catalog metadata only and must never become live executors. |

## Compatibility rules

- Built-in account IDs such as `qoder_<timestamp>` collapse to `qoder`; the model alias is `qd`.
- Legacy aliases are explicit compatibility mappings: `opencode` → `opencode_zen`, `cbai` → `codebuddy`, and `claude` → `claude`.
- Custom UUID providers resolve through their configured alias before built-in provider namespace matching.
- A model with a recognized provider prefix is matched by the registry, but prefix stripping must leave the model name unchanged after one recognized prefix.
- Double-prefix input is not normalized speculatively. It is accepted only when the provider's discovered model list contains an equivalent model ID; otherwise it is unknown.
- Unknown models must fail with the existing descriptive provider-connection error and must not be attributed to an arbitrary provider.

## Required test matrix

| Case | Input | Expected result |
| --- | --- | --- |
| Built-in prefixed model | `qoder/ultimate` | Resolves a registered `qoder_<account>` connection. |
| Built-in alias | `qd/ultimate` | Resolves the same Qoder connection. |
| Bare model | `ultimate` | Resolves when the registered provider advertises that bare model. |
| Account-suffixed ID | `qoder_123/ultimate` | Resolves the account and logs canonical provider `qoder`. |
| Custom provider | `custom-uuid/model` or `alias/model` | Resolves the custom UUID provider; alias wins over built-in namespace collisions. |
| Legacy alias | `opencode/model` | Maps to `opencode_zen` for canonical attribution. |
| Double prefix | `qoder/qoder/ultimate` | Only accepted if discovered model data explicitly supports that identity. |
| Unknown model | `unknown/model` | Throws the existing no-active-provider error. |

## Usage and billing decision for this hardening batch

Credit limits remain soft limits enforced between requests. Usage is charged only from usage data observed on a successful completion; a stream that emits partial output and then fails without usage data is not charged by the current request-finalization path. Hard atomic reservations and billing partial failed streams are separate product decisions and are not introduced here.

## Non-goals

- No public API wire-format change.
- No automatic rewriting of malformed model IDs.
- No change to provider catalog membership.
- No change to pricing data in this contract.
