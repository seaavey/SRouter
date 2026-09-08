# Contributing to SRouter

Thank you for your interest in contributing to **SRouter**! We welcome contributions from the community to help make SRouter the most reliable, high-performance, multi-provider AI gateway.

---

## 🧭 Code of Conduct

Please treat everyone with respect, kindness, and professionalism. Constructive feedback and inclusive collaboration are core values of this project.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: `v22+` or `v24+` (Native SQLite `node:sqlite` required)
- **pnpm**: `v10+` (`corepack enable pnpm`)
- **Git**

### Installation

1. **Fork and Clone**:

    ```bash
    git clone https://github.com/<your-username>/SRouter.git
    cd SRouter
    ```

2. **Install Dependencies**:

    ```bash
    pnpm install
    ```

3. **Start Development Environment**:
    ```bash
    pnpm dev
    ```
    This launches:
    - **Backend API**: `http://localhost:3000` (Hono Server & SQLite WAL)
    - **Frontend Dashboard**: `http://localhost:5173` (Vite + React 19 + TanStack Router)
    - **OAuth Listener**: `http://localhost:1455` (Automated PKCE Session Exchange)

---

## 🧪 Testing & Code Quality

Before submitting a Pull Request, run verification only for the apps and packages touched by the change. Do not run root-level Turbo tests, builds, or lint tasks on resource-constrained development environments.

```bash
# Run one focused API test file
cd apps/api
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts

# Build only the touched app or package
pnpm run build

# Check formatting only for changed files
pnpm exec prettier --check src/<changed-file>.ts tests/<changed-file>.test.ts

# Check whitespace errors
git diff --check
```

---

## 📂 Project Architecture

```
SRouter/
├── apps/
│   ├── api/             # Hono REST API server & OAuth controllers
│   └── web/             # Modern Dashboard UI (TanStack Router, React 19)
├── packages/
│   ├── constants/       # Global constants, presets & model catalogs
│   ├── db/              # SQLite repository layer (node:sqlite)
│   ├── executors/       # Upstream protocol drivers (Antigravity, Kiro, Codex, etc.)
│   ├── pricing/         # Model token pricing calculators
│   ├── providers/       # Multi-provider runtime coordinator & registry
│   ├── translator/      # OpenAI <-> Anthropic protocol transformers
│   └── types/           # Shared TypeScript interfaces & Zod schemas
└── turbo.json           # Turborepo build orchestration pipeline
```

---

## 📝 Commit Convention

We use **Conventional Commits** for clear, automated changelogs:

- `feat:` A new feature or capability
- `fix:` A bug fix
- `docs:` Documentation updates
- `refactor:` Code restructuring without behavioral changes
- `test:` Adding or updating automated tests
- `perf:` Performance optimizations
- `chore:` Maintenance, dependencies, or tooling adjustments

_Example:_ `feat(quota): add live quota tracking for upstream accounts`

---

## 🚀 Pull Request Process

1. Create a feature branch: `git checkout -b feat/your-feature-name`
2. Commit your changes following conventional commit syntax.
3. Verify the focused tests and builds for the touched apps or packages; do not claim broader checks were run unless they were explicitly executed.
4. Push to your fork and open a Pull Request against `main`.
5. Clearly describe the motivation, changes, and testing steps in your PR description.

---

## 📄 License

By contributing to SRouter, you agree that your contributions will be licensed under the [MIT License](LICENSE).
