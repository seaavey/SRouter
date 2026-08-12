import { getAllProvidersDB } from "@srouter/db";
import { AntigravityExecutor, AnthropicExecutor, CodexExecutor, CommandCodeExecutor, FreebuffExecutor, OpenAIExecutor } from "@srouter/executors";
import { ProviderRegistry } from "@srouter/providers";

// Create a global ProviderRegistry instance
export const registry = new ProviderRegistry();

// All persisted FreeBuff tokens share one coordinator; each DB row remains a
// separate runtime connection for pooling and failover.
export const freebuffExecutor = new FreebuffExecutor({
    id: "freebuff",
    name: "FreeBuff",
});

// 1. Register env-configured OpenAI Provider if present
if (process.env.OPENAI_API_KEY) {
    registry.registerProvider(
        new OpenAIExecutor({
            id: "openai",
            name: "OpenAI",
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        }),
    );
}

// 2. Register env-configured Anthropic Provider if present
if (process.env.ANTHROPIC_API_KEY) {
    registry.registerProvider(
        new AnthropicExecutor({
            id: "anthropic",
            name: "Anthropic",
            apiKey: process.env.ANTHROPIC_API_KEY,
            baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
        }),
    );
}

/**
 * Load saved OAuth & Custom providers from SQLite Database on startup
 */
export function loadSavedProvidersFromDB(): void {
    const savedProviders = getAllProvidersDB();
    const freebuffConnections = [] as {
        id: string;
        accessToken: string;
        baseUrl: string;
        enabled: boolean;
    }[];
    for (const p of savedProviders) {
        if (!p.enabled) continue;

        const providerType = p.providerId || p.id;
        const baseUrl = p.baseUrl || (providerType === "antigravity" || p.id.startsWith("antigravity") ? process.env.ANTIGRAVITY_BASE_URL : undefined);

        switch (true) {
            case providerType === "freebuff" || p.id.startsWith("freebuff_") || p.id.startsWith("freebuff-"):
                if (p.accessToken || p.apiKey) {
                    freebuffConnections.push({
                        id: p.id,
                        accessToken: p.accessToken || p.apiKey || "",
                        baseUrl: baseUrl || process.env.FREEBUFF_BASE_URL || "https://www.codebuff.com",
                        enabled: true,
                    });
                }
                break;
            case providerType === "commandcode" || p.id.startsWith("commandcode"):
                registry.registerProvider(
                    new CommandCodeExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                    }),
                );
                break;
            case providerType === "antigravity" || p.id.startsWith("antigravity"):
                registry.registerProvider(
                    new AntigravityExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                        refreshToken: p.refreshToken,
                    }),
                );
                break;
            case providerType === "openai_codex" || p.id.startsWith("openai_codex"):
                registry.registerProvider(
                    new CodexExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                        refreshToken: p.refreshToken,
                        accountId: p.accountId,
                    }),
                );
                break;
            case p.protocol === "openai" || p.category === "oauth" || providerType === "openai_codex" || providerType === "openai" || providerType === "custom_openai":
                registry.registerProvider(
                    new OpenAIExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                    }),
                );
                break;
            case p.protocol === "anthropic" || providerType === "anthropic" || providerType === "custom_anthropic":
                registry.registerProvider(
                    new AnthropicExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                    }),
                );
                break;
            default:
                break;
        }
    }
    freebuffExecutor.replaceConnections(freebuffConnections);
    if (freebuffConnections.length > 0) registry.registerProvider(freebuffExecutor);
    else registry.unregisterProvider("freebuff");
}

// Auto load saved DB providers
loadSavedProvidersFromDB();
