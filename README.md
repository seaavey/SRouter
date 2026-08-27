<div align="center">

# ⚡ SRouter

**Local-first AI gateway & LLM proxy for OpenAI, Anthropic, and custom models.**

Keep a single stable endpoint while SRouter routes requests, refreshes OAuth tokens, enforces quotas, and monitors live telemetry.

<p>
  <a href="https://github.com/seaavey/SRouter/releases"><img src="https://img.shields.io/badge/version-v0.1.3-6366f1?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://hono.dev/"><img src="https://img.shields.io/badge/Hono-v4.13-e36002?style=flat-square" alt="Hono"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-v19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React"></a>
  <a href="https://www.sqlite.org/"><img src="https://img.shields.io/badge/SQLite-WAL-003b57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite"></a>
</p>

<p align="center">
  <img src="docs/images/demo.gif" alt="SRouter Dashboard Walkthrough" width="100%">
</p>

[Quick Start](#-quick-start) • [Providers](#-supported-providers) • [Coding Tools](#-connect-coding-tools) • [Integrations](#-integrate) • [API](#-api-endpoints) • [Docker](#-docker)

</div>

---

## ⚡ Quick Start

Get SRouter running locally in under a minute.

### Option A: Docker (Recommended)

```bash
docker run -d \
  --name srouter \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 1455:1455 \
  -v srouter_data:/root/.srouter \
  ghcr.io/seaavey/srouter:latest
```

### Option B: Local Node.js

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
pnpm install
pnpm build
pnpm start
```

Open **`http://localhost:3000`** to access the dashboard. Configure your provider accounts under **Providers**, generate a virtual key in **API Keys**, and test endpoints immediately in **Playground**.

---

## 🔌 Connect Coding Tools

Use `@srouter/cli` to configure AI developer tools with one command:

```bash
# Interactive setup wizard
npx @srouter/cli setup

# Check status & link tools
npx @srouter/cli doctor
npx @srouter/cli link claude --model claude-3-7-sonnet
npx @srouter/cli link opencode --model antigravity/gemini-3.7-flash-high

# Run tools directly wrapped in SRouter environment
npx @srouter/cli run claude
```

### Manual Configuration (Cursor / Windsurf / Cline / Continue)

Point your editor or extension to your local SRouter instance:
- **Base URL:** `http://localhost:3000/v1`
- **API Key:** `sr-live-your_key` (or your master admin key)
- **Model:** Any model from `http://localhost:3000/v1/models` (e.g. `antigravity/gemini-3.7-flash-high`, `openai_codex/gpt-4o`)

---

## 🌐 Supported Providers

SRouter normalizes authentication and protocol differences across all major model providers:

| Provider | Model Prefix | Auth Method | Streaming | Live Quota |
| :--- | :--- | :--- | :---: | :---: |
| **Google Antigravity** | `antigravity/*` | OAuth 2.0 PKCE | ✅ | ✅ |
| **OpenAI Codex / ChatGPT** | `openai_codex/*` | OAuth 2.0 PKCE | ✅ | ✅ |
| **Anthropic Claude** | `anthropic/*` | API Key / OAuth | ✅ | ✅ |
| **OpenCode Zen** | `opencode_zen/*` | Free / Access Token | ✅ | ✅ |
| **Amazon Q / Kiro** | `kiro/*` | SigV4 / API Key | ✅ | ✅ |
| **Qoder** | `qoder/*` | OAuth / Device Token | ✅ | ✅ |
| **GoRouter** | `gorouter/*` | API Key | ✅ | ✅ |
| **BluesMinds** | `bluesminds/*` | API Key | ✅ | ✅ |
| **SeekAI / TabiToken** | `seekai/*`, `tabitoken/*` | API Key | ✅ | ✅ |
| **Custom Endpoints** | `custom/*` | Custom Headers | ✅ | Configurable |

---

## 💻 Integrate

SRouter exposes standard OpenAI and Anthropic compatible interfaces.

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sr-live-your_virtual_key"
)

stream = client.chat.completions.create(
    model="antigravity/gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Explain vector embeddings in one sentence."}],
    stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### Anthropic SDK (TypeScript)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
    baseURL: "http://localhost:3000/v1",
    apiKey: "sr-live-your_virtual_key"
});

const message = await client.messages.create({
    model: "anthropic/claude-3-7-sonnet",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello from SRouter!" }]
});

console.log(message.content[0].text);
```

### cURL

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your_virtual_key" \
  -d '{
    "model": "antigravity/gemini-3.7-flash-high",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": true
  }'
```

---

## 🎯 Core Features

- **Unified Protocol Translation:** Translate between OpenAI `chat/completions` and Anthropic `messages` formats dynamically.
- **Automated OAuth Refresh:** Background daemon automatically keeps short-lived OAuth sessions refreshed without downtime.
- **Failover & Smart Combo Routing:** Define cascade fallback chains to automatically recover from rate limits (`429`) or provider outages.
- **Token Saver Engine:** System-level prompt compression and concise coding rules to cut inference cost.
- **Virtual API Keys:** Issue scoped keys (`sr-live-*`) with individual rate limits, token quotas, and expiration windows.
- **Built-in Cloudflare Tunnel:** Expose your local gateway securely to the internet with zero open ports directly from the UI.
- **Embedded Observability:** Track exact token usage, cache efficiency, and estimated costs locally in SQLite WAL mode.

---

## 📡 API Endpoints

All gateway endpoints are served under `/v1`:

### Inference & Models
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/chat/completions` | OpenAI chat completion (streaming supported) |
| `POST` | `/v1/messages` | Anthropic messages endpoint |
| `GET` | `/v1/models` | List all discovered & connected models |
| `GET` | `/v1/models/:model` | Retrieve specific model schema & capabilities |

### Management & Metrics
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health check |
| `GET` | `/v1/quota` | Real-time provider balance & reset countdowns |
| `GET` / `POST` | `/v1/providers` | Read or connect provider accounts |
| `GET` / `POST` | `/v1/keys` | Manage virtual API keys |
| `GET` | `/v1/logs` | Query request audit logs and token telemetry |
| `GET` / `POST` | `/v1/tunnel/*` | Manage Cloudflare Tunnel daemon state |

---

## 🐳 Docker Compose

```yaml
services:
  srouter:
    image: ghcr.io/seaavey/srouter:latest
    container_name: srouter
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "1455:1455"
    volumes:
      - srouter_data:/root/.srouter
    environment:
      - PORT=3000
      - NODE_ENV=production

volumes:
  srouter_data:
```

---

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Start local dev server (API + Dashboard with HMR)
pnpm dev

# Quality checks
pnpm lint
pnpm test
pnpm build
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
