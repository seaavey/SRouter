import type { ProviderCategory, ProviderDefinition, ProviderProtocol } from "@srouter/types";
import { getConnectionsByProviderIdDB, upsertProviderDB } from "@srouter/db";
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

export class ProvidersLogic {
    public static listProviders(): ProviderDefinition[] {
        return registry.getCatalog();
    }

    public static getCatalog(): CatalogSummary {
        const catalog = registry.getCatalog();

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
        const catalog = registry.getCatalog();
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
        const id = payload.id && payload.id.trim() !== "" ? payload.id.toLowerCase().replace(/[^a-z0-9_-]/g, "") : `custom-${Date.now()}`;
        const name = payload.name.trim();
        const category = payload.category;
        const protocol = payload.protocol;
        const baseUrl = payload.baseUrl?.trim();
        const apiKey = payload.apiKey?.trim();

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
            requiresApiKey: false,
            models: [],
            status: { state: "connected" },
        };
    }
}

