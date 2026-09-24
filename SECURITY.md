# Security Policy

The SRouter team and community take the security of our gateway, credentials, and routing infrastructure seriously.

---

## 🛡️ Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| `1.x.x` | :white_check_mark: |

---

## 🔒 Security Architecture Highlights

1. **Local-First Credential Isolation**:
    - OAuth tokens, refresh keys, and provider secrets are stored exclusively in your local SQLite database (`srouter.db`) on your own infrastructure or device.
    - SRouter never phones home, collects telemetry, or sends your API keys to third-party tracking servers.

2. **Virtual Client Keys (`sr-live-...`)**:
    - Clients and downstream applications interact with SRouter using virtual API keys, completely isolating your upstream master provider keys.

3. **Opt-in Enforced Authentication**:
    - You can enforce Bearer authentication on all gateway endpoints via `/settings` (`Require API Key: Required`).

---

## 🚨 Reporting a Vulnerability

If you discover a potential security vulnerability or sensitive information exposure in SRouter, please do **NOT** disclose it in a public GitHub issue.

Please report it privately via:

- **Email**: `security@srouter.web.id` (or open a private GitHub Security Advisory)

### What to include in your report:

- A clear description of the vulnerability.
- Steps or a minimal proof-of-concept (PoC) to reproduce the issue.
- Impact assessment (e.g. unauthorized token access, denial of service).

We will acknowledge receipt within **24 hours** and provide regular status updates until a patch is released.
