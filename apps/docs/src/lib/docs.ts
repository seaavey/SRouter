export type DocEntry = {
    title: string;
    href: string;
    section: string;
    description: string;
    source?: string;
    keywords: string[];
};

export type NavGroup = {
    label: string;
    items: DocEntry[];
};

const entries: DocEntry[] = [
    {
        title: "Overview",
        href: "/",
        section: "Start here",
        description: "Map the SRouter workspace and the request path through the gateway.",
        keywords: ["home", "workspace", "architecture", "source map"]
    },
    {
        title: "Getting started",
        href: "/docs/getting-started/",
        section: "Start here",
        description:
            "Connect a provider, create a key, configure the gateway, and send a first request.",
        source: "README.md",
        keywords: ["quickstart", "first request", "provider", "api key", "setup"]
    },
    {
        title: "Installation",
        href: "/docs/installation/",
        section: "Start here",
        description: "Install SRouter with Docker or run it directly from the source code.",
        source: "Dockerfile",
        keywords: ["install", "installation", "docker", "source", "compose", "node", "pnpm"]
    },
    {
        title: "Architecture",
        href: "/docs/concepts/architecture/",
        section: "Start here",
        description: "See how the API, dashboard, CLI, and shared packages fit together.",
        source: "AGENTS.md",
        keywords: ["system", "components", "apps", "packages", "boundaries"]
    },
    {
        title: "Request lifecycle",
        href: "/docs/concepts/request-lifecycle/",
        section: "Build with SRouter",
        description:
            "Follow a request from authentication and validation to translation and streaming.",
        source: "apps/api/src/controllers/chat.controller.ts",
        keywords: ["request", "middleware", "routing", "executor", "stream", "flow"]
    },
    {
        title: "Providers and routing",
        href: "/docs/concepts/providers-routing/",
        section: "Build with SRouter",
        description: "Configure provider edges, model prefixes, combos, and fallback behavior.",
        source: "packages/providers/src/registry.ts",
        keywords: ["provider", "model", "combo", "fallback", "oauth", "quota"]
    },
    {
        title: "Keys and observability",
        href: "/docs/concepts/keys-observability/",
        section: "Build with SRouter",
        description: "Use virtual API keys and inspect quotas, logs, analytics, and pricing.",
        source: "apps/api/src/routes/v1/keys.ts",
        keywords: ["api key", "quota", "logs", "analytics", "pricing", "telemetry"]
    },
    {
        title: "OpenAI-compatible API",
        href: "/docs/integrations/openai/",
        section: "Integrate",
        description: "Connect OpenAI SDKs and clients to SRouter chat completions.",
        source: "apps/api/src/routes/v1/chat.ts",
        keywords: ["openai", "chat", "sdk", "python", "completion"]
    },
    {
        title: "Anthropic-compatible API",
        href: "/docs/integrations/anthropic/",
        section: "Integrate",
        description: "Connect Anthropic SDKs and clients to the messages endpoint.",
        source: "apps/api/src/routes/v1/messages.ts",
        keywords: ["anthropic", "messages", "claude", "sdk", "typescript"]
    },
    {
        title: "Streaming and SSE",
        href: "/docs/integrations/streaming/",
        section: "Integrate",
        description: "Understand streaming responses, events, retries, and live telemetry.",
        source: "packages/executors/src/sse.ts",
        keywords: ["streaming", "sse", "server sent events", "events", "realtime"]
    },
    {
        title: "Coding tools",
        href: "/docs/integrations/coding-tools/",
        section: "Integrate",
        description: "Configure Claude Code and OpenCode with the SRouter CLI.",
        source: "apps/cli/src/adapters",
        keywords: ["claude", "opencode", "coding tools", "adapter", "environment"]
    },
    {
        title: "API routes",
        href: "/docs/reference/api-routes/",
        section: "Reference",
        description: "Browse the complete mounted HTTP route surface and its auth boundary.",
        source: "apps/api/src/index.ts",
        keywords: ["routes", "http", "endpoint", "hono", "rest"]
    },
    {
        title: "Authentication",
        href: "/docs/reference/authentication/",
        section: "Reference",
        description: "Choose between virtual API keys, admin sessions, OAuth, and CSRF protection.",
        source: "apps/api/src/middleware",
        keywords: ["auth", "api key", "admin", "oauth", "csrf", "security"]
    },
    {
        title: "Environment variables",
        href: "/docs/reference/environment/",
        section: "Reference",
        description: "Configure ports, storage, OAuth callbacks, serving, and runtime behavior.",
        source: "apps/api/src/services/startup.ts",
        keywords: ["env", "configuration", "port", "database", "oauth", "docker"]
    },
    {
        title: "Errors and limits",
        href: "/docs/reference/errors/",
        section: "Reference",
        description:
            "Understand validation errors, rate limits, body limits, and upstream failures.",
        source: "apps/api/src/utils/response.ts",
        keywords: ["errors", "status", "validation", "rate limit", "body limit", "retry"]
    },
    {
        title: "CLI",
        href: "/docs/cli/",
        section: "Project",
        description: "Configure SRouter and connected coding tools from the terminal.",
        source: "apps/cli/src/index.ts",
        keywords: ["cli", "commands", "setup", "link", "run", "database"]
    },
    {
        title: "Shared packages",
        href: "/docs/packages/",
        section: "Project",
        description:
            "Trace contracts, persistence, executors, translators, providers, and pricing.",
        source: "packages",
        keywords: ["packages", "types", "db", "executors", "translator", "pricing"]
    },
    {
        title: "Database",
        href: "/docs/development/database/",
        section: "Project",
        description:
            "Understand SQLite defaults, PostgreSQL support, schema initialization, and transfer.",
        source: "packages/db/src/db.ts",
        keywords: ["database", "sqlite", "postgres", "schema", "migration", "backup"]
    },
    {
        title: "Testing and verification",
        href: "/docs/development/testing/",
        section: "Project",
        description: "Run focused checks without hiding failures behind broad workspace commands.",
        source: "AGENTS.md",
        keywords: ["test", "lint", "build", "prettier", "ci", "verification"]
    },
    {
        title: "Contributing",
        href: "/docs/contributing/",
        section: "Project",
        description: "Make focused changes while preserving application and package boundaries.",
        source: "AGENTS.md",
        keywords: ["contributing", "development", "pull request", "workflow"]
    }
];

export const navGroups: NavGroup[] = [
    { label: "Start here", items: entries.slice(0, 4) },
    { label: "Build with SRouter", items: entries.slice(4, 7) },
    { label: "Integrate", items: entries.slice(7, 11) },
    { label: "Reference", items: entries.slice(11, 15) },
    { label: "Project", items: entries.slice(15) }
];

export const docs = entries;

export function findDoc(pathname: string): DocEntry | undefined {
    const normalized = pathname === "/" ? "/" : `${pathname.replace(/\/+$/, "")}/`;
    return docs.find((entry) => entry.href === normalized);
}

export function sourceUrl(source?: string): string | undefined {
    if (!source) return undefined;
    const isFile = /\.[a-z0-9]+$/i.test(source);
    return `https://github.com/seaavey/SRouter/${isFile ? "blob" : "tree"}/main/${source}`;
}
