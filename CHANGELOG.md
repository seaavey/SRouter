# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.1] - 2026-08-18

### 🚀 Production Release Highlights

#### 🔀 Model Combo & Automated Failover Cascades (`/combo`)

- **Dedicated Model Combo Dashboard (`/combo`)**: Visual pipeline grouping displaying multi-step failover chains (_Step 1 Primary ➔ Step 2 Failover ➔ Step 3 Backup_) with provider logos and model capability badges (Vision 👁️ & Reasoning 🧠).
- **macOS-Style Creation & Picker Modal**: Interactive dialog with real-time regex alias validation, model priority reordering, and model selector grouped by provider.
- **1-Click Starter Templates**: Instant setup for _Flagship Fallback Chain_, _High Throughput & Speed_, and _Deep Reasoning Mix_.
- **Direct Target Dispatch & Zero Idle Latency**: Combo aliases directly route to target model chains without candidate 0 execution delays.
- **Case-Insensitive Resolution**: Fallback matching supports case-insensitive model identifiers (`claude` matches `Claude`).
- **Resilient Fallback Triggers**: Automated failover on HTTP 429, 403, 5xx, missing provider drivers, rate limit exhaustion, and upstream connection failures.
- **Developer Devtools**: One-click **"Test in Playground"** and instant **"Copy cURL"** command export.

#### ✂️ Multi-Stage Token Saver Engine (`/settings/token-saver`)

- **Rule-Based Prompt Compression**: Reduces prompt token overhead and upstream cost before LLM execution.
- **Configurable Strategies**: Customizable whitespace compaction, redundant comment stripping, and repetitive string compression.
- **Dashboard Metrics**: Dedicated settings interface showing estimated cost savings and compression ratios.

#### 🛡️ Robust Validation & Error Resilience

- **Graceful Malformed JSON Handling**: Safely parses malformed JSON and empty request bodies returning standard OpenAI `invalid_request_error` (HTTP 400) without throwing unhandled Hono `HTTPException`.
- **Global Error Handling**: Comprehensive error normalization across root listeners and secondary OAuth port (1455).

---

## [0.1.0-rc.2] - 2026-08-16

### 🚀 Release Candidate 2 Highlights

#### 🧩 Providers Catalog & Custom Provider Wizard

- **2-Step Custom Provider Wizard Modal**: Clean step-by-step modal with official OpenAI and Anthropic branding logos.
- **Upstream Connection Verification**: Added `POST /v1/providers/verify` endpoint and interactive "Uji API Key" tool in the wizard.
- **Protocol-Strict URL Validation**: Enforcement of `http://` / `https://` schemes with clear Toast-only error reporting.
- **Redesigned Providers Catalog**: Clean modern grid layout with responsive filters, count badges, live connection state pulses, and optimized search.

#### ⚙️ Settings & UI Polish

- **Sticky Desktop Navigation Tabs**: Settings navigation tabs remain sticky at the top during scroll.
- **Keys Management Cleanup**: Modularized virtual API keys tables, dialogs, and metrics.
- **Styling Token Standardization**: Consistent use of semantic CSS theme tokens across all dashboard views.

---

## [0.1.0-rc.1] - 2026-08-15

### 🚀 Release Candidate 1 Highlights

#### 🔌 New Upstream AI Providers

- **GoRouter**: Native OpenAI-compatible executor supporting live chat completions, streaming, and custom branding (`https://gorouter.app`).
- **BluesMinds**: OpenAI-compatible gateway integration with instant token management (`https://api.bluesminds.com/v1`).
- **SeekAI**: High-performance OpenAI-compatible proxy with dynamic model catalog discovery (`https://seekai.cc/v1`).
- **TabiToken**: OpenAI-compatible proxy supporting Claude models, streaming, and custom referral link (`https://tabitoken.com/v1`).
- **Qoder**: Complete Alibaba Cloud Qoder integration featuring OAuth PKCE device flow, WAF-bypass body encoding, and live token refresh.

#### 🤖 Anthropic Messages API & Claude Code Compatibility

- **Native `/v1/messages` Endpoint**: Full support for Anthropic Messages protocol with non-streaming and real-time SSE streaming.
- **Claude Code Ready**: Drop-in proxy support for Claude Code CLI, Cursor, and official Anthropic SDKs.
- **Bidirectional Translation**: Real-time conversion between Anthropic message format and OpenAI completion requests.

#### 🐳 Containerization & Deployment

- **Multi-Stage Dockerfile**: Lightweight production container image with Node 22 alpine.
- **Docker Compose**: Ready-to-run `docker-compose.yml` with SQLite persistence volumes.
- **Embedded SPA Serving**: Hono API automatically serves static web dashboard assets in production.

#### 🎨 Web Dashboard & Playground Enhancements

- **Simplified Connection Modal**: Streamlined modal dialog replacing slide-out sheets, focusing solely on API Key inputs with show/hide toggles.
- **Instant Playground Feedback (0ms)**: Assistant message placeholder, ThinkingState, and LoadingState render immediately on prompt submission.
- **Reasoning Delta Streaming**: Real-time extraction and streaming for `reasoning_content`, `thought`, and `thinking` chunks.
- **Interactive Toasts**: Toast notifications via `sonner` across connection lifecycle events.
- **Direct Provider Web Links**: One-click navigation to provider consoles and referral portals.

---

## [0.1.0-beta] - 2026-08-15

### 🚀 Initial Public Beta Release

#### 🔀 AI Gateway & Protocol Routing

- **OpenAI & Anthropic Compatible Proxy**: Full support for `POST /v1/chat/completions`, `GET /v1/models`, and `GET /v1/models/:model`.
- **Server-Sent Events (SSE) Streaming**: Real-time streaming chunks with usage breakdown normalization and thinking/reasoning model delta preservation.
- **Protocol Translation**: Automatic bidirectional translation between OpenAI JSON Schema function definitions and Anthropic tools.

#### 🌐 Multi-Provider Catalog

- **Supported Upstreams**:
    - Google Antigravity (Gemini 2.5 Flash / Pro)
    - OpenAI Codex & ChatGPT (GPT-4o, o3-mini)
    - Anthropic Claude (Claude 3.7 Sonnet)
    - Neosantara AI
    - Kiro (Amazon Q / CodeWhisperer)
    - Command Code
- **Dynamic Model Discovery**: Direct upstream catalog polling without hardcoded model tables.
- **Provider Management**: Connect, configure, test, and manage upstream accounts.

#### 🔄 Token Sweeper & OAuth PKCE

- **Embedded OAuth Callback Server**: Dedicated listener on port `1455` for seamless browser PKCE authorization.
- **Automated Sweeper**: 60-second periodic background daemon refreshing expiring OAuth tokens with lead time guarantees.

#### 📊 Live Quotas & Limits (`/quota`)

- **Real-Time Telemetry**: Visual progress bars with status badges (`ok`, `warning`, `exhausted`).
- **Reset Countdown Timers**: Localized human-readable reset timestamps.
- **Collapsible Provider Cards**: Per-account cards with individual sync and global expand/collapse.

#### 🔑 Virtual API Keys & Security (`/keys`, `/settings`)

- **Virtual Client Keys**: Secure `sr-live-...` keys for downstream clients with quota limits and usage tracking.
- **Enforced Security Mode**: Toggleable `Require API Key` gateway setting rejecting unauthorized requests with HTTP 401.
- **Open Access Mode**: Seamless unauthenticated access for local development and private sandboxes.

#### 🧪 Web Playground (`/playground`)

- **Interactive Chat Studio**: Multi-session tabs, parameter tuning (temperature, max tokens, system prompts).
- **Reasoning Visualization**: Collapsible thinking blocks for reasoning models.
- **One-Click Code Export**: Copy cURL, Python, TypeScript, and JSON snippets instantly.

#### 🎨 Editorial Minimalist UI

- **Modern Stack**: TanStack Table v8, TanStack Router, React 19, Tailwind CSS v4, Base UI.
- **Theme Transitions**: Dark/Light mode with View Transitions API.
- **Responsive Layout**: Fluid typography, Bento metric summaries, and sidebar navigation.
