import {
    DEFAULT_PROVIDER_MAP,
    isProviderCategory,
    isSeedProvider,
    providerAlias
} from "@srouter/constants";
import type {
    CreateProviderZod,
    ModelObject,
    ProviderCategory,
    ProviderConfig,
    ProviderDefinition,
    ProviderProtocol,
    VerifyProviderZod
} from "@srouter/types";
import {
    addCustomModelDB,
    deleteCustomModelDB,
    getAllProvidersDB,
    getCustomModelsByProviderDB,
    upsertProviderDB
} from "@srouter/db";
import { loadSavedProvidersFromDB, registry } from "@/services/registry.js";
import { AssertPublicUrl } from "@/utils/ssrf.js";

export interface GroupedCatalog {
    oauth: ProviderDefinition[];
    free_tier: ProviderDefinition[];
    api_key: ProviderDefinition[];
}

export interface CatalogSummary {
    total: number;
    categories: GroupedCatalog;
}

export type CreateProviderPayload = CreateProviderZod;

function isProviderProtocol(Value: string): Value is ProviderProtocol {
    return ["openai", "anthropic", "gemini", "custom"].includes(Value);
}

const PROVIDER_IDS_BY_LENGTH = Object.keys(DEFAULT_PROVIDER_MAP).sort(
    (Left, Right) => Right.length - Left.length
);

function BaseIdOf(ProviderId: string): string {
    for (const Id of PROVIDER_IDS_BY_LENGTH) {
        if (
            ProviderId === Id ||
            ProviderId.startsWith(`${Id}_`) ||
            ProviderId.startsWith(`${Id}-`)
        ) {
            return Id;
        }
    }
    return ProviderId;
}

function ProviderDefinitionFromConfig(Connection: ProviderConfig): ProviderDefinition {
    const Category: ProviderCategory =
        Connection.category && isProviderCategory(Connection.category)
            ? Connection.category
            : "api_key";

    return {
        id: Connection.id,
        name: Connection.name,
        category: Category,
        protocol:
            Connection.protocol && isProviderProtocol(Connection.protocol)
                ? Connection.protocol
                : "openai",
        default_base_url: Connection.base_url,
        requires_api_key: Boolean(Connection.apiKey),
        supports_custom_url: true,
        status: { state: "connected", connectedCount: 1 },
        models: []
    };
}

function CatalogWithSavedProviders(): ProviderDefinition[] {
    const Rows = getAllProvidersDB();
    const Catalog: ProviderDefinition[] = [];
    const Seen = new Set<string>();

    for (const Connection of Rows) {
        const BaseId = BaseIdOf(Connection.providerId || Connection.id);
        if (Seen.has(BaseId)) continue;
        Seen.add(BaseId);

        const Seed = DEFAULT_PROVIDER_MAP[BaseId];
        const Category: ProviderCategory =
            Connection.category && isProviderCategory(Connection.category)
                ? Connection.category
                : (Seed?.category ?? "api_key");
        const Protocol: ProviderProtocol =
            Connection.protocol && isProviderProtocol(Connection.protocol)
                ? Connection.protocol
                : (Seed?.protocol ?? "openai");

        const ConnectedCount = Rows.filter(
            (C) => !isSeedProvider(C) && C.enabled && BaseIdOf(C.providerId || C.id) === BaseId
        ).length;

        Catalog.push({
            id: BaseId,
            name: Seed?.name ?? Connection.name,
            category: Seed?.category ?? Category,
            protocol: Seed?.protocol ?? Protocol,
            default_base_url: Seed?.base_url ?? Connection.base_url,
            requires_api_key: Seed ? Seed.requires_api_key : Boolean(Connection.apiKey),
            requires_oauth: Seed?.requires_oauth,
            supports_custom_url: Seed ? (Seed.supports_custom_url ?? true) : true,
            status: {
                state: ConnectedCount > 0 ? "connected" : "no_connections",
                message: Seed?.status_message,
                connectedCount: ConnectedCount
            },
            models: []
        });
    }

    for (const Seed of Object.values(DEFAULT_PROVIDER_MAP)) {
        if (Seen.has(Seed.id)) continue;
        Seen.add(Seed.id);

        Catalog.push({
            id: Seed.id,
            name: Seed.name,
            category: Seed.category,
            protocol: Seed.protocol,
            default_base_url: Seed.base_url,
            requires_api_key: Seed.requires_api_key,
            requires_oauth: Seed.requires_oauth,
            supports_custom_url: Seed.supports_custom_url ?? true,
            status: {
                state: "no_connections",
                message: Seed.status_message,
                connectedCount: 0
            },
            models: []
        });
    }

    return Catalog;
}

export class ProvidersLogic {
    public static ListProviders(): ProviderDefinition[] {
        return CatalogWithSavedProviders();
    }

    public static GetCatalog(): CatalogSummary {
        const Catalog = CatalogWithSavedProviders();

        const Categories: GroupedCatalog = {
            oauth: Catalog.filter((P) => P.category === "oauth"),
            free_tier: Catalog.filter((P) => P.category === "free_tier"),
            api_key: Catalog.filter((P) => P.category === "api_key")
        };

        return {
            total: Catalog.length,
            categories: Categories
        };
    }

    public static async GetProviderById(ProviderId: string): Promise<ProviderDefinition | null> {
        const Catalog = CatalogWithSavedProviders();
        const Provider = Catalog.find((P) => P.id.toLowerCase() === ProviderId.toLowerCase());
        if (!Provider) return null;

        const Connections = getAllProvidersDB().filter(
            (C) => !isSeedProvider(C) && BaseIdOf(C.providerId || C.id) === ProviderId
        );
        const ConnectedCount = Connections.filter((C) => C.enabled).length;

        let LiveModels = Provider.models;
        const MatchingProviders = Array.from(registry.getAllProviders().values()).filter(
            (P) =>
                P.id === ProviderId ||
                P.id.startsWith(`${ProviderId}_`) ||
                P.id.startsWith(`${ProviderId}-`)
        );

        if (MatchingProviders.length > 0) {
            const ModelMap = new Map<string, ModelObject>();
            for (const M of Provider.models) {
                ModelMap.set(M.id, M);
            }
            for (const P of MatchingProviders) {
                try {
                    const Fetched = await registry.getProviderModels(P);
                    for (const M of Fetched) {
                        ModelMap.set(M.id, M);
                    }
                } catch {}
            }
            if (ModelMap.size > 0) {
                LiveModels = Array.from(ModelMap.values());
            }
        }

        const CustomModels = ProvidersLogic.ListCustomModels(ProviderId);
        if (CustomModels.length > 0) {
            const Merged = new Map<string, ModelObject>();
            for (const M of LiveModels) {
                Merged.set(M.id.toLowerCase(), M);
            }
            for (const M of CustomModels) {
                Merged.set(M.id.toLowerCase(), M);
            }
            LiveModels = Array.from(Merged.values());
        }

        return {
            ...Provider,
            connections: Connections,
            models: LiveModels,
            status: {
                ...Provider.status,
                connectedCount: ConnectedCount,
                state: ConnectedCount > 0 ? "connected" : "no_connections"
            }
        };
    }

    public static AddProvider(Payload: CreateProviderPayload): ProviderDefinition {
        const Name = Payload.name?.trim();
        if (!Name) throw new Error("Provider name is required");
        if (!isProviderCategory(Payload.category)) throw new Error("Invalid provider category");
        if (!isProviderProtocol(Payload.protocol)) throw new Error("Invalid provider protocol");
        const RawId = Payload.id?.trim();
        const BaseId = RawId
            ? RawId.toLowerCase().replace(/[^a-z0-9_-]/g, "")
            : Payload.category;
        const Id = RawId ? BaseId : `${BaseId}_${Date.now()}`;
        if (!Id)
            throw new Error("Provider ID must contain letters, numbers, underscores, or hyphens");
        if (getAllProvidersDB().some((Provider) => Provider.id === Id))
            throw new Error(`Provider ID '${Id}' already exists`);
        const Category = Payload.category;
        const Protocol = Payload.protocol;
        const BaseUrl = Payload.base_url?.trim();
        if (BaseUrl) {
            try {
                const Url = new URL(BaseUrl);
                if (!["http:", "https:"].includes(Url.protocol))
                    throw new Error("unsupported protocol");
            } catch {
                throw new Error("Base URL must be a valid HTTP or HTTPS URL");
            }
        }
        const ApiKey = Payload.api_key?.trim();
        if (Category === "api_key" && !ApiKey)
            throw new Error("API key is required for API key providers");

        const Config = {
            id: Id,
            providerId: Payload.provider_id || Id,
            name: Name,
            category: Category,
            protocol: Protocol,
            base_url: BaseUrl,
            apiKey: ApiKey,
            accessToken: Payload.access_token,
            refreshToken: Payload.refresh_token,
            providerSpecificData: Payload.provider_specific_data,
            customHeaders: Payload.custom_headers,
            enabled: true,
            createdAt: Date.now()
        };

        upsertProviderDB(Config);
        loadSavedProvidersFromDB();

        return ProviderDefinitionFromConfig(Config);
    }

    public static AddCustomModel(ProviderId: string, ModelId: string): ModelObject {
        const Id = ProviderId.toLowerCase();
        if (
            !DEFAULT_PROVIDER_MAP[Id] &&
            !getAllProvidersDB().some((P) => BaseIdOf(P.providerId || P.id) === Id)
        ) {
            throw new Error(`Provider '${ProviderId}' not found`);
        }
        const Trimmed = ModelId.trim();
        if (!Trimmed) throw new Error("Model ID is required");
        if (Trimmed.length > 200 || !/^[A-Za-z0-9._\-/: ]+$/.test(Trimmed))
            throw new Error(
                "Model ID may only contain letters, numbers, dots, dashes, underscores, slashes, colons, and spaces"
            );

        addCustomModelDB(Id, Trimmed);
        const FullId = `${providerAlias(Id)}/${Trimmed}`;
        registry.clearModelsCache();
        return { id: FullId, object: "model", owned_by: providerAlias(Id) };
    }

    public static DeleteCustomModel(ProviderId: string, ModelId: string): void {
        const Deleted = deleteCustomModelDB(ProviderId.toLowerCase(), ModelId);
        if (!Deleted) throw new Error(`Custom model '${ModelId}' not found for '${ProviderId}'`);
        registry.clearModelsCache();
    }

    public static ListCustomModels(ProviderId: string): ModelObject[] {
        const Alias = providerAlias(ProviderId.toLowerCase());
        return getCustomModelsByProviderDB(ProviderId.toLowerCase()).map((Row) => ({
            id: `${Alias}/${Row.modelId}`,
            object: "model" as const,
            owned_by: Alias,
            custom: true
        }));
    }

    public static async VerifyConnection(Payload: VerifyProviderZod): Promise<{
        success: boolean;
        message: string;
        modelsCount?: number;
    }> {
        const Protocol = Payload.protocol || "openai";
        const RawBaseUrl = Payload.base_url?.trim() || "";
        const BaseUrl = RawBaseUrl.replace(/\/+$/, "");
        const ApiKey = Payload.api_key?.trim();

        if (BaseUrl) {
            try {
                await AssertPublicUrl(BaseUrl);
            } catch (Err) {
                return {
                    success: false,
                    message:
                        Err instanceof Error
                            ? `Target URL tidak diizinkan: ${Err.message}`
                            : "Format Endpoint Base URL tidak valid."
                };
            }
        }

        try {
            if (Protocol === "anthropic") {
                let TargetUrl: string;
                if (!BaseUrl) {
                    TargetUrl = "https://api.anthropic.com/v1/models";
                } else if (BaseUrl.endsWith("/v1")) {
                    TargetUrl = `${BaseUrl}/models`;
                } else {
                    TargetUrl = `${BaseUrl}/v1/models`;
                }

                const Headers: Record<string, string> = {
                    "User-Agent": "SRouter/1.0.0 (Node.js)",
                    Accept: "application/json",
                    "anthropic-version": "2023-06-01"
                };
                if (ApiKey) {
                    Headers["x-api-key"] = ApiKey;
                }

                const Res = await fetch(TargetUrl, {
                    method: "GET",
                    headers: Headers,
                    redirect: "manual",
                    signal: AbortSignal.timeout(8000)
                });

                if (Res.ok) {
                    const Data = (await Res.json().catch(() => ({}))) as {
                        data?: unknown[];
                    };
                    const Count = Array.isArray(Data?.data) ? Data.data.length : undefined;
                    return {
                        success: true,
                        message:
                            Count !== undefined
                                ? `Koneksi Anthropic valid! (${Count} model ditemukan)`
                                : "Koneksi Anthropic berhasil diverifikasi.",
                        modelsCount: Count
                    };
                }

                if (Res.status >= 300 && Res.status < 400) {
                    return {
                        success: false,
                        message: "Redirect tidak diikuti untuk verifikasi (potensi SSRF)."
                    };
                }

                if (Res.status === 401) {
                    return {
                        success: false,
                        message: "Autentikasi gagal: API key Anthropic tidak valid (HTTP 401)."
                    };
                }

                const ErrBody = await Res.text().catch(() => "");
                return {
                    success: false,
                    message: `Upstream error (HTTP ${Res.status}): ${Res.statusText || ErrBody.slice(0, 100)}`
                };
            }

            let TargetUrl: string;
            if (!BaseUrl) {
                TargetUrl = "https://api.openai.com/v1/models";
            } else if (BaseUrl.endsWith("/models")) {
                TargetUrl = BaseUrl;
            } else {
                TargetUrl = `${BaseUrl}/models`;
            }

            const Headers: Record<string, string> = {
                "User-Agent": "SRouter/1.0.0 (Node.js)",
                "Accept-Encoding": "identity",
                Accept: "application/json"
            };
            if (ApiKey) {
                Headers["Authorization"] = `Bearer ${ApiKey}`;
            }

            const Res = await fetch(TargetUrl, {
                method: "GET",
                headers: Headers,
                redirect: "manual",
                signal: AbortSignal.timeout(8000)
            });

            if (Res.ok) {
                const Data = (await Res.json().catch(() => ({}))) as {
                    data?: unknown[];
                };
                const Count = Array.isArray(Data?.data) ? Data.data.length : undefined;
                return {
                    success: true,
                    message:
                        Count !== undefined
                            ? `Koneksi OpenAI valid! (${Count} model ditemukan)`
                            : "Koneksi OpenAI berhasil diverifikasi.",
                    modelsCount: Count
                };
            }

            if (Res.status >= 300 && Res.status < 400) {
                return {
                    success: false,
                    message: "Redirect tidak diikuti untuk verifikasi (potensi SSRF)."
                };
            }

            if (Res.status === 401) {
                return {
                    success: false,
                    message: "Autentikasi gagal: API key salah atau kedaluwarsa (HTTP 401)."
                };
            }

            const ErrBody = await Res.text().catch(() => "");
            return {
                success: false,
                message: `Upstream error (HTTP ${Res.status}): ${Res.statusText || ErrBody.slice(0, 100)}`
            };
        } catch (Err) {
            const Msg = Err instanceof Error ? Err.message : "Tidak dapat terhubung ke endpoint.";
            return { success: false, message: `Gagal terhubung ke host: ${Msg}` };
        }
    }
}
