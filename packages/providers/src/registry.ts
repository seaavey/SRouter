import {
    isProviderBaseId,
    providerAlias,
    providerBaseId,
    providerTypeForAlias
} from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject,
    ProviderDefinition
} from "@srouter/types";
import { CircuitBreaker, circuitBreaker as defaultCircuitBreaker } from "./circuitBreaker.js";

export function getProviderAlias(providerId: string): string {
    return providerAlias(providerBaseId(providerId));
}

// Strip any {alias}/ or {providerId}/ prefix from a model id, returning the bare id.
function stripModelPrefix(modelId: string, alias: string, providerId: string): string {
    if (modelId.startsWith(`${alias}/`)) return modelId.slice(alias.length + 1);
    if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
    const baseId = providerBaseId(providerId);
    if (modelId.startsWith(`${baseId}/`)) return modelId.slice(baseId.length + 1);
    const slash = modelId.indexOf("/");
    if (slash >= 0) return modelId.slice(slash + 1);
    return modelId;
}

interface CachedProviderModels {
    models: ModelObject[];
    cachedAt: number;
}

interface ModelSnapshot {
    models: ModelObject[];
    cachedAt: number;
    retryAt?: number;
}

interface ProviderModelResult {
    providerId: string;
    alias: string;
    models: ModelObject[];
}

const DEFAULT_MODELS_FETCH_TIMEOUT_MS = 5_000;
const INITIAL_MODELS_WAIT_MS = 1_000;
const MODEL_REFRESH_CONCURRENCY = 4;
const MODEL_FAILURE_COOLDOWN_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Provider model discovery timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

export class ProviderRegistry {
    private providers: Map<string, AIProvider> = new Map();
    private defaultProvider: AIProvider;
    private circuitBreaker: CircuitBreaker;
    private modelsCache: Map<string, CachedProviderModels> = new Map();
    private modelsInflight: Map<string, Promise<ModelObject[]>> = new Map();
    private modelsFailures: Map<string, number> = new Map();
    private modelsSnapshot?: ModelSnapshot;
    private modelsRefreshInflight?: Promise<ModelObject[]>;
    private modelsGeneration = 0;
    private modelsRefreshPending = false;
    private modelsTtlMs: number = 5 * 60 * 1000; // 5 minutes default TTL
    private modelsFetchTimeoutMs: number = DEFAULT_MODELS_FETCH_TIMEOUT_MS;

    constructor(
        defaultProvider?: AIProvider,
        modelsTtlMs?: number,
        circuitBreakerInstance?: CircuitBreaker
    ) {
        if (modelsTtlMs !== undefined) {
            this.modelsTtlMs = modelsTtlMs;
        }
        this.circuitBreaker = circuitBreakerInstance ?? defaultCircuitBreaker;
        this.defaultProvider = defaultProvider ?? {
            id: "default",
            name: "Default Provider",
            category: "api_key",
            protocol: "openai",
            listModels: async () => [],
            chatCompletion: async (req: ChatCompletionRequest) => {
                throw new Error(
                    `No active provider connection found for model "${req.model}". Please connect a provider account in the Providers tab or verify the model name.`
                );
            },
            chatCompletionStream: async function* (
                req: ChatCompletionRequest
            ): AsyncGenerator<ChatCompletionChunk, void, void> {
                throw new Error(
                    `No active provider connection found for model "${req.model}". Please connect a provider account in the Providers tab or verify the model name.`
                );
            }
        };
        this.registerProvider(this.defaultProvider);
    }

    getCircuitBreaker(): CircuitBreaker {
        return this.circuitBreaker;
    }

    setModelsTtlMs(ttlMs: number): void {
        this.modelsTtlMs = ttlMs;
    }

    setModelsFetchTimeoutMs(timeoutMs: number): void {
        this.modelsFetchTimeoutMs = Math.max(1, timeoutMs);
    }

    clearModelsCache(providerId?: string): void {
        if (providerId) {
            this.modelsCache.delete(providerId);
            this.modelsInflight.delete(providerId);
            this.modelsFailures.delete(providerId);
        } else {
            this.modelsCache.clear();
            this.modelsInflight.clear();
            this.modelsFailures.clear();
        }
        this.modelsSnapshot = undefined;
        this.modelsGeneration++;
        if (this.modelsRefreshInflight) {
            this.modelsRefreshPending = true;
        }
    }

    async getProviderModels(provider: AIProvider, forceRefresh = false): Promise<ModelObject[]> {
        if (!provider || provider.id === "default") return [];

        const inflight = this.modelsInflight.get(provider.id);
        if (inflight) {
            return inflight;
        }

        const now = Date.now();
        const cached = this.modelsCache.get(provider.id);

        if (!forceRefresh && cached && now - cached.cachedAt < this.modelsTtlMs) {
            return cached.models;
        }

        const failureAt = this.modelsFailures.get(provider.id);
        if (
            !forceRefresh &&
            failureAt !== undefined &&
            now - failureAt < MODEL_FAILURE_COOLDOWN_MS
        ) {
            return cached?.models ?? [];
        }

        const fetchPromise = (async () => {
            try {
                const models = await withTimeout(provider.listModels(), this.modelsFetchTimeoutMs);
                const safeModels = Array.isArray(models) ? models : [];
                this.modelsCache.set(provider.id, {
                    models: safeModels,
                    cachedAt: Date.now()
                });
                this.modelsFailures.delete(provider.id);
                return safeModels;
            } catch (err) {
                this.modelsFailures.set(provider.id, Date.now());
                if (cached) {
                    return cached.models;
                }
                return [];
            }
        })();

        this.modelsInflight.set(provider.id, fetchPromise);
        void fetchPromise.then(
            () => {
                if (this.modelsInflight.get(provider.id) === fetchPromise) {
                    this.modelsInflight.delete(provider.id);
                }
            },
            () => {
                if (this.modelsInflight.get(provider.id) === fetchPromise) {
                    this.modelsInflight.delete(provider.id);
                }
            }
        );
        return fetchPromise;
    }

    async refreshModels(forceRefresh = false): Promise<ModelObject[]> {
        if (this.modelsRefreshInflight) {
            return this.modelsRefreshInflight;
        }

        const generation = this.modelsGeneration;
        const refreshPromise = this.refreshModelsInternal(forceRefresh, generation);
        this.modelsRefreshInflight = refreshPromise;
        void refreshPromise.then(
            () => {
                if (this.modelsRefreshInflight === refreshPromise) {
                    this.modelsRefreshInflight = undefined;
                    if (this.modelsRefreshPending || generation !== this.modelsGeneration) {
                        this.modelsRefreshPending = false;
                        void this.refreshModels(forceRefresh).catch(() => undefined);
                    }
                }
            },
            () => {
                if (this.modelsRefreshInflight === refreshPromise) {
                    this.modelsRefreshInflight = undefined;
                    if (this.modelsRefreshPending || generation !== this.modelsGeneration) {
                        this.modelsRefreshPending = false;
                        void this.refreshModels(forceRefresh).catch(() => undefined);
                    }
                }
            }
        );
        return refreshPromise;
    }

    private async refreshModelsInternal(
        forceRefresh: boolean,
        generation: number
    ): Promise<ModelObject[]> {
        const activeProviders = Array.from(this.providers.values()).filter(
            (provider) => provider.id !== "default"
        );
        const results: Array<ProviderModelResult | undefined> = new Array(activeProviders.length);
        let nextIndex = 0;

        const refreshWorker = async (): Promise<void> => {
            while (true) {
                const index = nextIndex++;
                const provider = activeProviders[index];
                if (!provider) return;

                results[index] = {
                    providerId: provider.id,
                    alias: getProviderAlias(provider.id),
                    models: await this.getProviderModels(provider, forceRefresh)
                };
            }
        };

        const workerCount = Math.min(MODEL_REFRESH_CONCURRENCY, activeProviders.length);
        await Promise.all(Array.from({ length: workerCount }, () => refreshWorker()));

        const modelResults = results.filter(
            (result): result is ProviderModelResult => result !== undefined
        );
        const models = this.buildModelList(modelResults);
        if (generation !== this.modelsGeneration) {
            return models;
        }

        const failureTimes = activeProviders
            .map((provider) => this.modelsFailures.get(provider.id))
            .filter((failureAt): failureAt is number => failureAt !== undefined);

        this.modelsSnapshot = {
            models,
            cachedAt: Date.now(),
            retryAt:
                failureTimes.length > 0
                    ? Math.min(...failureTimes) + MODEL_FAILURE_COOLDOWN_MS
                    : undefined
        };
        return models;
    }

    registerProvider(provider: AIProvider): void {
        this.providers.set(provider.id, provider);
        this.clearModelsCache(provider.id);
    }

    unregisterProvider(providerId: string): boolean {
        this.clearModelsCache(providerId);
        return this.providers.delete(providerId);
    }

    getProvider(providerId: string): AIProvider | undefined {
        return this.providers.get(providerId);
    }

    getAllProviders(): Map<string, AIProvider> {
        return this.providers;
    }

    /**
     * Live catalog derived from registered providers. One entry per base driver
     * id, collapsing multi-account connections (e.g. openai_1700000000 → openai).
     */
    getCatalog(): ProviderDefinition[] {
        const seen = new Set<string>();
        const catalog: ProviderDefinition[] = [];

        for (const provider of this.providers.values()) {
            if (provider.id === "default") continue;
            const baseId = providerBaseId(provider.id);
            if (seen.has(baseId)) continue;
            seen.add(baseId);

            const connectedCount = Array.from(this.providers.keys()).filter(
                (id) => id === baseId || id.startsWith(`${baseId}_`) || id.startsWith(`${baseId}-`)
            ).length;

            catalog.push({
                id: baseId,
                name: provider.name,
                category: provider.category ?? "api_key",
                protocol: provider.protocol ?? "openai",
                requires_api_key: true,
                supports_custom_url: true,
                status: { state: "connected", connectedCount },
                models: []
            });
        }

        return catalog;
    }

    async getCandidateProvidersForModel(modelId: string): Promise<AIProvider[]> {
        const candidates: AIProvider[] = [];

        // 1. Direct match from registered providers' listModels() (cached)
        const activeProviders = Array.from(this.providers.values()).filter(
            (p) => p.id !== "default"
        );

        const modelLists = await Promise.all(
            activeProviders.map(async (provider) => {
                const models = await this.getProviderModels(provider);
                return { provider, models };
            })
        );

        for (const { provider, models } of modelLists) {
            const alias = getProviderAlias(provider.id);
            const baseId = providerBaseId(provider.id);
            if (
                models.some((m) => {
                    const bareId = stripModelPrefix(m.id, alias, provider.id);
                    return (
                        m.id === modelId ||
                        `${alias}/${bareId}` === modelId ||
                        `${baseId}/${bareId}` === modelId ||
                        bareId === modelId
                    );
                })
            ) {
                candidates.push(provider);
            }
        }

        // 2. Prefix matching for provider ID or alias (e.g., qd/*, qoder/*, antigravity/*, openai/*)
        if (candidates.length === 0) {
            const prefix = modelId.includes("/") ? (modelId.split("/")[0] ?? modelId) : modelId;
            const targetBaseId = providerTypeForAlias(prefix) ?? prefix;
            for (const [id, provider] of this.providers.entries()) {
                if (id === "default") continue;
                const baseId = providerBaseId(id);
                const alias = providerAlias(baseId);
                if (
                    isProviderBaseId(id, prefix) ||
                    isProviderBaseId(id, targetBaseId) ||
                    prefix === alias ||
                    targetBaseId === baseId
                ) {
                    candidates.push(provider);
                }
            }
        }

        if (candidates.length > 0) {
            // Sort by circuit breaker health and apply round-robin shuffle among healthy candidates
            return this.circuitBreaker.sortCandidatesByHealth(candidates);
        }

        if (this.defaultProvider.id !== "default") {
            return [this.defaultProvider];
        }

        throw new Error(
            `No active provider connection found for model "${modelId}". Please connect a provider account in the Providers tab (e.g. Qoder, OpenAI, Antigravity) or verify the model prefix.`
        );
    }

    async getProviderForModel(modelId: string): Promise<AIProvider> {
        const candidates = await this.getCandidateProvidersForModel(modelId);
        return candidates[0] ?? this.defaultProvider;
    }

    private buildModelList(results: ProviderModelResult[]): ModelObject[] {
        const allModels: ModelObject[] = [];
        const seenIds = new Set<string>();

        for (const { providerId, alias, models } of results) {
            for (const model of models) {
                const bareId = stripModelPrefix(model.id, alias, providerId);
                const id = `${alias}/${bareId}`;
                if (seenIds.has(id)) continue;

                seenIds.add(id);
                allModels.push({ id, object: "model", owned_by: alias });
            }
        }

        return allModels;
    }

    private filterModels(models: ModelObject[], providerFilter?: string): ModelObject[] {
        if (!providerFilter) return models;
        const filter = providerFilter.toLowerCase();
        return models.filter((model) => {
            const owner = model.owned_by.toLowerCase();
            return owner === filter || owner.startsWith(filter);
        });
    }

    async listAllModels(providerFilter?: string, forceRefresh = false): Promise<ModelObject[]> {
        const snapshot = this.modelsSnapshot;
        const now = Date.now();
        const snapshotNeedsRefresh =
            !snapshot ||
            now - snapshot.cachedAt >= this.modelsTtlMs ||
            (snapshot.retryAt !== undefined && now >= snapshot.retryAt);

        if (forceRefresh) {
            await this.waitForInitialModels(true);
        } else if (!snapshot) {
            await this.waitForInitialModels(false);
        } else if (snapshotNeedsRefresh) {
            void this.refreshModels().catch(() => undefined);
        }

        return this.filterModels(this.modelsSnapshot?.models ?? [], providerFilter);
    }

    private async waitForInitialModels(forceRefresh: boolean): Promise<void> {
        const deadline = Date.now() + INITIAL_MODELS_WAIT_MS;
        while (forceRefresh || !this.modelsSnapshot) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) break;

            try {
                await withTimeout(this.refreshModels(forceRefresh), remainingMs);
            } catch {
                break;
            }

            if (this.modelsSnapshot) return;
        }

        // A refresh invalidated while it was running is automatically queued
        // again. The loop above observes that second refresh before returning.
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const candidates = await this.getCandidateProvidersForModel(req.model);
        let lastError: unknown = null;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            try {
                const response = await candidate.chatCompletion(req);
                this.circuitBreaker.recordSuccess(candidate.id);
                return response;
            } catch (err) {
                lastError = err;
                this.circuitBreaker.recordFailure(candidate.id, err);
                if (i < candidates.length - 1) {
                    continue;
                }
            }
        }

        throw lastError;
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const candidates = await this.getCandidateProvidersForModel(req.model);
        let lastError: unknown = null;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            let yieldedAny = false;
            try {
                const stream = candidate.chatCompletionStream(req);
                for await (const chunk of stream) {
                    if (!yieldedAny) {
                        yieldedAny = true;
                        this.circuitBreaker.recordSuccess(candidate.id);
                    }
                    yield chunk;
                }
                if (yieldedAny) {
                    return;
                }
            } catch (err) {
                lastError = err;
                this.circuitBreaker.recordFailure(candidate.id, err);
                if (yieldedAny || i === candidates.length - 1) {
                    throw err;
                }
            }
        }

        if (lastError) throw lastError;
    }
}
