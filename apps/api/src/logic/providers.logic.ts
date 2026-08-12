import type { ProviderCategory, ProviderDefinition, ProviderProtocol } from "@srouter/types";
import { getAllProvidersDB, getConnectionsByProviderIdDB, upsertProviderDB } from "@srouter/db";
import { loadSavedProvidersFromDB, registry } from "@/services/registry.js";

export interface GroupedCatalog {
    custom: ProviderDefinition[];
    oauth: ProviderDefinition[];
    free_tier: ProviderDefinition[];
    api_key: ProviderDefinition[];
}

export interface CatalogSummary {
    total: number;
    categories: GroupedCatalog;
}

export interface CreateProviderPayload {
    id?: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    apiKey?: string;
}

function isProviderCategory(value: string): value is ProviderCategory {
    return ["custom", "oauth", "free_tier", "api_key"].includes(value);
}

function isProviderProtocol(value: string): value is ProviderProtocol {
    return ["openai", "anthropic", "gemini", "custom"].includes(value);
}

function catalogWithSavedCustomProviders(): ProviderDefinition[] {
    const catalog = [...registry.getCatalog()];
    const knownIds = new Set(catalog.map((provider) => provider.id));
    for (const connection of getAllProvidersDB()) {
        const providerId = connection.providerId || connection.id;
        if (knownIds.has(providerId) || !connection.enabled) continue;
        knownIds.add(providerId);
        catalog.push({
            id: providerId,
            name: connection.name,
            category: connection.category && isProviderCategory(connection.category) ? connection.category : "custom",
            protocol: connection.protocol && isProviderProtocol(connection.protocol) ? connection.protocol : "openai",
            defaultBaseUrl: connection.baseUrl,
            requiresApiKey: Boolean(connection.apiKey),
            supportsCustomUrl: true,
            status: { state: "connected", connectedCount: 1 },
            models: [],
        });
    }
    return catalog;
}

export class ProvidersLogic {
    public static listProviders(): ProviderDefinition[] {
        return catalogWithSavedCustomProviders();
    }

    public static getCatalog(): CatalogSummary {
        const catalog = catalogWithSavedCustomProviders();

        const categories: GroupedCatalog = {
            custom: catalog.filter((p) => p.category === "custom"),
            oauth: catalog.filter((p) => p.category === "oauth"),
            free_tier: catalog.filter((p) => p.category === "free_tier"),
            api_key: catalog.filter((p) => p.category === "api_key"),
        };

        return {
            total: catalog.length,
            categories,
        };
    }

    public static async getProviderById(providerId: string): Promise<ProviderDefinition | null> {
        const catalog = catalogWithSavedCustomProviders();
        const provider = catalog.find((p) => p.id.toLowerCase() === providerId.toLowerCase());
        if (!provider) return null;

        const connections = getConnectionsByProviderIdDB(providerId);
        const connectedCount = connections.filter((c) => c.enabled).length;

        let liveModels = provider.models;
        const registeredProvider = registry.getProvider(providerId) ||
            Array.from(registry.getAllProviders().values()).find(
                (p) => p.id.startsWith(providerId) || p.id.startsWith(`${providerId}_`) || p.id.startsWith(`${providerId}-`)
            );

        if (registeredProvider) {
            try {
                const fetched = await registeredProvider.listModels();
                if (fetched.length > 0) {
                    liveModels = fetched;
                }
            } catch {
                // fallback to catalog models
            }
        }

        return {
            ...provider,
            connections,
            models: liveModels,
            status: {
                ...provider.status,
                connectedCount,
                state: connectedCount > 0 ? "connected" : "disconnected",
            },
        };
    }

    public static addProvider(payload: CreateProviderPayload): ProviderDefinition {
        const name = payload.name?.trim();
        if (!name) throw new Error("Provider name is required");
        if (!isProviderCategory(payload.category)) throw new Error("Invalid provider category");
        if (!isProviderProtocol(payload.protocol)) throw new Error("Invalid provider protocol");
        const rawId = payload.id?.trim();
        const id = rawId ? rawId.toLowerCase().replace(/[^a-z0-9_-]/g, "") : `custom-${Date.now()}`;
        if (!id) throw new Error("Provider ID must contain letters, numbers, underscores, or hyphens");
        if (getAllProvidersDB().some((provider) => provider.id === id)) throw new Error(`Provider ID '${id}' already exists`);
        const category = payload.category;
        const protocol = payload.protocol;
        const baseUrl = payload.baseUrl?.trim();
        if (baseUrl) {
            try {
                const url = new URL(baseUrl);
                if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
            } catch {
                throw new Error("Base URL must be a valid HTTP or HTTPS URL");
            }
        }
        const apiKey = payload.apiKey?.trim();
        if (category === "api_key" && !apiKey) throw new Error("API key is required for API key providers");

        const config = {
            id,
            providerId: id,
            name,
            category,
            protocol,
            baseUrl,
            apiKey,
            enabled: true,
            createdAt: Date.now(),
        };

        upsertProviderDB(config);
        loadSavedProvidersFromDB();

        return {
            id: config.id,
            name: config.name,
            protocol: config.protocol,
            category: config.category,
            requiresApiKey: Boolean(config.apiKey),
            supportsCustomUrl: true,
            models: [],
            status: { state: "connected", connectedCount: 1 },
        };
    }
}

