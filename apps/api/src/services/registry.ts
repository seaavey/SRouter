import { getAllProvidersDB } from "@srouter/db";
import { AntigravityExecutor, AnthropicExecutor, CodexExecutor, CommandCodeExecutor, KiroExecutor, OpenAIExecutor } from "@srouter/executors";
import { ProviderRegistry } from "@srouter/providers";

// Create a global ProviderRegistry instance
export const registry = new ProviderRegistry();

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

// 3. Register env-configured Neosantara Provider if present
if (process.env.NEOSANTARA_API_KEY) {
    registry.registerProvider(
        new OpenAIExecutor({
            id: "neosantara",
            name: "Neosantara",
            apiKey: process.env.NEOSANTARA_API_KEY,
            baseUrl: process.env.NEOSANTARA_BASE_URL || "https://api.neosantara.xyz/v1",
        }),
    );
}

/**
 * Load saved OAuth & Custom providers from SQLite Database on startup
 */
export function loadSavedProvidersFromDB(): void {
    const savedProviders = getAllProvidersDB();
    for (const p of savedProviders) {
        if (!p.enabled) continue;

        const providerType = p.providerId || p.id;
        const baseUrl = p.baseUrl || (providerType === "antigravity" || p.id.startsWith("antigravity") ? process.env.ANTIGRAVITY_BASE_URL : undefined);

        switch (true) {
            case providerType === "kiro" || p.id.startsWith("kiro"):
                registry.registerProvider(
                    new KiroExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl,
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
                        refreshToken: p.refreshToken,
                        providerSpecificData: p.providerSpecificData,
                    }),
                );
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
            case providerType === "neosantara" || p.id.startsWith("neosantara"):
                registry.registerProvider(
                    new OpenAIExecutor({
                        id: p.id || p.providerId,
                        name: p.name,
                        baseUrl: baseUrl || process.env.NEOSANTARA_BASE_URL || "https://api.neosantara.xyz/v1",
                        apiKey: p.apiKey,
                        accessToken: p.accessToken,
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
}

// Auto load saved DB providers
loadSavedProvidersFromDB();
