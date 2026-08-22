import {
    DEFAULT_PROVIDER_MAP,
    isProviderCategory,
    isSeedProvider,
    providerAlias
} from "@srouter/constants";
import type {
    ModelObject,
    ProviderCategory,
    ProviderConfig,
    ProviderDefinition,
    ProviderProtocol
} from "@srouter/types";
import {
    addCustomModelDB,
    deleteCustomModelDB,
    getAllProvidersDB,
    getCustomModelsByProviderDB,
    upsertProviderDB
} from "@srouter/db";
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
    accessToken?: string;
    refreshToken?: string;
    providerSpecificData?: Record<string, string>;
}

function isProviderProtocol(value: string): value is ProviderProtocol {
    return ["openai", "anthropic", "gemini", "custom"].includes(value);
}

/**
 * Resolves a provider/connection id to its base driver id. Known drivers are
 * matched by id or `id_<suffix>` / `id-<suffix>` prefixes so multi-account
 * connections collapse under one driver (e.g. openai_codex_1700000000 →
 * openai_codex). Custom ids that match no known driver keep their full id.
 */
function baseIdOf(providerId: string): string {
    for (const id of Object.keys(DEFAULT_PROVIDER_MAP)) {
        if (
            providerId === id ||
            providerId.startsWith(`${id}_`) ||
            providerId.startsWith(`${id}-`)
        ) {
            return id;
        }
    }
    return providerId;
}

function providerDefinitionFromConfig(connection: ProviderConfig): ProviderDefinition {
    return {
        id: connection.id,
        name: connection.name,
        category:
            connection.category && isProviderCategory(connection.category)
                ? connection.category
                : "custom",
        protocol:
            connection.protocol && isProviderProtocol(connection.protocol)
                ? connection.protocol
                : "openai",
        defaultBaseUrl: connection.baseUrl,
        requiresApiKey: Boolean(connection.apiKey),
        supportsCustomUrl: true,
        status: { state: "connected", connectedCount: 1 },
        models: []
    };
}

/**
 * Builds the dashboard catalog purely from the SQLite providers table. Built-in
 * drivers appear through their seeded rows; connections are grouped under their
 * base driver id. Seed rows describe a driver but carry no credentials, so they
 * are excluded from connection/status counts.
 */
function catalogWithSavedCustomProviders(): ProviderDefinition[] {
    const rows = getAllProvidersDB();
    const catalog: ProviderDefinition[] = [];
    const seen = new Set<string>();

    for (const connection of rows) {
        const baseId = baseIdOf(connection.providerId || connection.id);
        if (seen.has(baseId)) continue;
        seen.add(baseId);

        const seed = DEFAULT_PROVIDER_MAP[baseId];
        const category: ProviderCategory =
            connection.category && isProviderCategory(connection.category)
                ? connection.category
                : "custom";
        const protocol: ProviderProtocol =
            connection.protocol && isProviderProtocol(connection.protocol)
                ? connection.protocol
                : "openai";

        const connectedCount = rows.filter(
            (c) => !isSeedProvider(c) && c.enabled && baseIdOf(c.providerId || c.id) === baseId
        ).length;

        catalog.push({
            id: baseId,
            name: seed?.name ?? connection.name,
            category: seed?.category ?? category,
            protocol: seed?.protocol ?? protocol,
            defaultBaseUrl: seed?.baseUrl ?? connection.baseUrl,
            requiresApiKey: seed ? seed.requiresApiKey : Boolean(connection.apiKey),
            requiresOAuth: seed?.requiresOAuth,
            supportsCustomUrl: seed ? (seed.supportsCustomUrl ?? true) : true,
            status: {
                state: connectedCount > 0 ? "connected" : "no_connections",
                message: seed?.statusMessage,
                connectedCount
            },
            models: []
        });
    }

    // Ensure all built-in drivers appear in the catalog
    for (const seed of Object.values(DEFAULT_PROVIDER_MAP)) {
        if (seen.has(seed.id)) continue;
        seen.add(seed.id);

        catalog.push({
            id: seed.id,
            name: seed.name,
            category: seed.category,
            protocol: seed.protocol,
            defaultBaseUrl: seed.baseUrl,
            requiresApiKey: seed.requiresApiKey,
            requiresOAuth: seed.requiresOAuth,
            supportsCustomUrl: seed.supportsCustomUrl ?? true,
            status: {
                state: "no_connections",
                message: seed.statusMessage,
                connectedCount: 0
            },
            models: []
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
            api_key: catalog.filter((p) => p.category === "api_key")
        };

        return {
            total: catalog.length,
            categories
        };
    }

    public static async getProviderById(providerId: string): Promise<ProviderDefinition | null> {
        const catalog = catalogWithSavedCustomProviders();
        const provider = catalog.find((p) => p.id.toLowerCase() === providerId.toLowerCase());
        if (!provider) return null;

        // Resolve connections by base driver id so multi-account rows (e.g.
        // neosantara-1786…) show up on their driver's page (e.g. /providers/neosantara).
        const connections = getAllProvidersDB().filter(
            (c) => !isSeedProvider(c) && baseIdOf(c.providerId || c.id) === providerId
        );
        const connectedCount = connections.filter((c) => c.enabled).length;

        let liveModels = provider.models;
        const matchingProviders = Array.from(registry.getAllProviders().values()).filter(
            (p) =>
                p.id === providerId ||
                p.id.startsWith(`${providerId}_`) ||
                p.id.startsWith(`${providerId}-`)
        );

        if (matchingProviders.length > 0) {
            const modelMap = new Map<string, ModelObject>();
            for (const m of provider.models) {
                modelMap.set(m.id, m);
            }
            for (const p of matchingProviders) {
                try {
                    const fetched = await registry.getProviderModels(p);
                    for (const m of fetched) {
                        modelMap.set(m.id, m);
                    }
                } catch {
                    // ignore individual provider model fetch failure
                }
            }
            if (modelMap.size > 0) {
                liveModels = Array.from(modelMap.values());
            }
        }

        // Merge user-added custom models (custom entries win over duplicates)
        const customModels = ProvidersLogic.listCustomModels(providerId);
        if (customModels.length > 0) {
            const merged = new Map<string, ModelObject>();
            for (const m of liveModels) {
                merged.set(m.id.toLowerCase(), m);
            }
            for (const m of customModels) {
                merged.set(m.id.toLowerCase(), m);
            }
            liveModels = Array.from(merged.values());
        }

        return {
            ...provider,
            connections,
            models: liveModels,
            status: {
                ...provider.status,
                connectedCount,
                state: connectedCount > 0 ? "connected" : "no_connections"
            }
        };
    }

    public static addProvider(payload: CreateProviderPayload): ProviderDefinition {
        const name = payload.name?.trim();
        if (!name) throw new Error("Provider name is required");
        if (!isProviderCategory(payload.category)) throw new Error("Invalid provider category");
        if (!isProviderProtocol(payload.protocol)) throw new Error("Invalid provider protocol");
        const rawId = payload.id?.trim();
        const id = rawId ? rawId.toLowerCase().replace(/[^a-z0-9_-]/g, "") : `custom-${Date.now()}`;
        if (!id)
            throw new Error("Provider ID must contain letters, numbers, underscores, or hyphens");
        if (getAllProvidersDB().some((provider) => provider.id === id))
            throw new Error(`Provider ID '${id}' already exists`);
        const category = payload.category;
        const protocol = payload.protocol;
        const baseUrl = payload.baseUrl?.trim();
        if (baseUrl) {
            try {
                const url = new URL(baseUrl);
                if (!["http:", "https:"].includes(url.protocol))
                    throw new Error("unsupported protocol");
            } catch {
                throw new Error("Base URL must be a valid HTTP or HTTPS URL");
            }
        }
        const apiKey = payload.apiKey?.trim();
        if (category === "api_key" && !apiKey)
            throw new Error("API key is required for API key providers");

        const config = {
            id,
            providerId: id,
            name,
            category,
            protocol,
            baseUrl,
            apiKey,
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            providerSpecificData: payload.providerSpecificData,
            enabled: true,
            createdAt: Date.now()
        };

        upsertProviderDB(config);
        loadSavedProvidersFromDB();

        return providerDefinitionFromConfig(config);
    }

    /**
     * Add a user-defined model to a provider driver. Stored in SQLite and
     * merged into the model listing; routing works via alias prefix matching.
     */
    public static addCustomModel(providerId: string, modelId: string): ModelObject {
        const id = providerId.toLowerCase();
        if (
            !DEFAULT_PROVIDER_MAP[id] &&
            !getAllProvidersDB().some((p) => baseIdOf(p.providerId || p.id) === id)
        ) {
            throw new Error(`Provider '${providerId}' not found`);
        }
        const trimmed = modelId.trim();
        if (!trimmed) throw new Error("Model ID is required");
        if (trimmed.length > 200 || !/^[A-Za-z0-9._\-/: ]+$/.test(trimmed))
            throw new Error(
                "Model ID may only contain letters, numbers, dots, dashes, underscores, slashes, colons, and spaces"
            );

        addCustomModelDB(id, trimmed);
        const fullId = `${providerAlias(id)}/${trimmed}`;
        registry.clearModelsCache();
        return { id: fullId, object: "model", owned_by: providerAlias(id) };
    }

    public static deleteCustomModel(providerId: string, modelId: string): void {
        const deleted = deleteCustomModelDB(providerId.toLowerCase(), modelId);
        if (!deleted) throw new Error(`Custom model '${modelId}' not found for '${providerId}'`);
        registry.clearModelsCache();
    }

    public static listCustomModels(providerId: string): ModelObject[] {
        const alias = providerAlias(providerId.toLowerCase());
        return getCustomModelsByProviderDB(providerId.toLowerCase()).map((row) => ({
            id: `${alias}/${row.modelId}`,
            object: "model" as const,
            owned_by: alias,
            custom: true
        }));
    }

    public static async verifyConnection(payload: {
        protocol: ProviderProtocol;
        baseUrl?: string;
        apiKey?: string;
    }): Promise<{ success: boolean; message: string; modelsCount?: number }> {
        const protocol = payload.protocol || "openai";
        const baseUrl = (payload.baseUrl?.trim() || "").replace(/\/+$/, "");
        const apiKey = payload.apiKey?.trim();

        if (baseUrl) {
            try {
                const url = new URL(baseUrl);
                if (!["http:", "https:"].includes(url.protocol)) {
                    return {
                        success: false,
                        message: "URL endpoint harus berformat HTTP atau HTTPS."
                    };
                }
                const hostname = url.hostname.toLowerCase();
                const isInternalHost =
                    hostname === "169.254.169.254" ||
                    hostname === "metadata.google.internal" ||
                    hostname === "instance-data";
                if (isInternalHost) {
                    return {
                        success: false,
                        message: "Target URL tidak diizinkan untuk verifikasi (metadata endpoint diblokir)."
                    };
                }
            } catch {
                return { success: false, message: "Format Endpoint Base URL tidak valid." };
            }
        }

        try {
            if (protocol === "anthropic") {
                const targetUrl = baseUrl
                    ? `${baseUrl}/v1/models`
                    : "https://api.anthropic.com/v1/models";
                const headers: Record<string, string> = {
                    "User-Agent": "SRouter/1.0.0 (Node.js)",
                    Accept: "application/json",
                    "anthropic-version": "2023-06-01"
                };
                if (apiKey) {
                    headers["x-api-key"] = apiKey;
                }

                const res = await fetch(targetUrl, {
                    method: "GET",
                    headers,
                    signal: AbortSignal.timeout(8000)
                });

                if (res.ok) {
                    const data = (await res.json().catch(() => ({}))) as {
                        data?: unknown[];
                    };
                    const count = Array.isArray(data?.data) ? data.data.length : undefined;
                    return {
                        success: true,
                        message:
                            count !== undefined
                                ? `Koneksi Anthropic valid! (${count} model ditemukan)`
                                : "Koneksi Anthropic berhasil diverifikasi.",
                        modelsCount: count
                    };
                }

                if (res.status === 401) {
                    return {
                        success: false,
                        message: "Autentikasi gagal: API key Anthropic tidak valid (HTTP 401)."
                    };
                }

                const errBody = await res.text().catch(() => "");
                return {
                    success: false,
                    message: `Upstream error (HTTP ${res.status}): ${res.statusText || errBody.slice(0, 100)}`
                };
            }

            // OpenAI / Custom OpenAI compatible
            const targetUrl = baseUrl ? `${baseUrl}/models` : "https://api.openai.com/v1/models";
            const headers: Record<string, string> = {
                "User-Agent": "SRouter/1.0.0 (Node.js)",
                "Accept-Encoding": "identity",
                Accept: "application/json"
            };
            if (apiKey) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            const res = await fetch(targetUrl, {
                method: "GET",
                headers,
                signal: AbortSignal.timeout(8000)
            });

            if (res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    data?: unknown[];
                };
                const count = Array.isArray(data?.data) ? data.data.length : undefined;
                return {
                    success: true,
                    message:
                        count !== undefined
                            ? `Koneksi OpenAI valid! (${count} model ditemukan)`
                            : "Koneksi OpenAI berhasil diverifikasi.",
                    modelsCount: count
                };
            }

            if (res.status === 401) {
                return {
                    success: false,
                    message: "Autentikasi gagal: API key salah atau kedaluwarsa (HTTP 401)."
                };
            }

            const errBody = await res.text().catch(() => "");
            return {
                success: false,
                message: `Upstream error (HTTP ${res.status}): ${res.statusText || errBody.slice(0, 100)}`
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Tidak dapat terhubung ke endpoint.";
            return { success: false, message: `Gagal terhubung ke host: ${msg}` };
        }
    }
}
