# Contributing to SRouter

Thank you for your interest in contributing to **SRouter**! We welcome contributions that help make
SRouter the most reliable, high-performance, multi-provider AI gateway.

---

## 🧭 Code of Conduct

Please treat everyone with respect, kindness, and professionalism. Constructive feedback and
inclusive collaboration are core values of this project.

---

## 🛠️ Development Setup

### Prerequisites

- **Rust**: the stable toolchain (`rustup default stable`); `server/rust-toolchain.toml` pins the
  version this crate builds with
- **Git**
- **Node.js `>=22`** only if you want to run the Prettier documentation gate

### Installation

1. **Fork and Clone**:

    ```bash
    git clone https://github.com/<your-username>/SRouter.git
    cd SRouter
    ```

2. **Build and run the server**:

    ```bash
    cargo run --manifest-path server/Cargo.toml
    ```

    The API listens on `:3000` (single listener, OAuth callbacks under `/v1/auth/*` included) and
    keeps its SQLite WAL database at `~/.srouter/srouter.db`. Set `PORT` or `DATABASE_PATH` to move
    either one.

    The dashboard, the CLI, and the documentation site that used to live under `apps/` were deleted
    on 2026-10-08 and are preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

---

## 🧪 Testing & Code Quality

Run verification for what you touched, and run the full suite before opening a pull request.

```bash
# One focused test file
cargo test --manifest-path server/Cargo.toml --test <focused-file>

# The whole suite, what CI runs
cargo test --manifest-path server/Cargo.toml --locked

# Formatting and lints
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings

# Markdown and configuration formatting, and whitespace errors
pnpm exec prettier --check <changed files>
git diff --check
```

`server/bindings.ts` is generated. After changing a wire type, regenerate it and commit the result:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts
```

---

## 📂 Project Architecture

```
SRouter/
├── server/              # Rust/Axum API gateway (single listener, SQLite WAL)
│   ├── src/app.rs       # router mounts
│   ├── src/features/    # gateway, providers, catalog, logs, admin, database transfer
│   ├── src/infrastructure/ # persistence and schema migrations (v4)
│   ├── src/constants.rs # client-facing copy and header constants
│   ├── migrations/      # SQL migrations
│   ├── tests/           # integration suites and the shared test support module
│   └── bindings.ts      # generated TypeScript view of the wire types
├── docs/                # contract, migration, and schema documents
├── Dockerfile           # two stages: Rust build, then a Node-free runtime
└── docker-compose.yml   # the single service that runs the server
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
3. Verify the tests and checks that apply to your change; do not claim broader checks were run
   unless they were explicitly executed.
4. Push to your fork and open a pull request against `main`.
5. Clearly describe the motivation, changes, and testing steps in your PR description.

---

## 📄 License

By contributing to SRouter, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
