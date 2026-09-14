export interface ServerHealthResult {
    healthy: boolean;
    models_count: number;
    error?: string;
    latency_ms?: number;
}

export function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, "");
}

export function getModelsEndpoint(baseUrl: string): string {
    const cleanUrl = normalizeBaseUrl(baseUrl);
    return cleanUrl.endsWith("/v1") ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;
}

interface ModelItem {
    id?: string;
}

interface ModelsApiResponse {
    data?: Array<ModelItem | string>;
}

export async function checkServerHealth(
    baseUrl: string,
    apiKey?: string,
    timeoutMs: number = 3000
): Promise<ServerHealthResult> {
    const endpoint = getModelsEndpoint(baseUrl);
    const start = Date.now();

    try {
        const headers: Record<string, string> = {
            Accept: "application/json"
        };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(endpoint, {
            method: "GET",
            headers,
            signal: controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
            return {
                healthy: false,
                models_count: 0,
                error: `HTTP ${res.status}: ${res.statusText}`,
                latency_ms: Date.now() - start
            };
        }

        const data = (await res.json()) as ModelsApiResponse;
        const models = Array.isArray(data?.data) ? data.data : [];

        return {
            healthy: true,
            models_count: models.length,
            latency_ms: Date.now() - start
        };
    } catch (err: unknown) {
        const errorName = err instanceof Error ? err.name : "";
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            healthy: false,
            models_count: 0,
            error: errorName === "AbortError" ? "Connection timeout" : errorMessage,
            latency_ms: Date.now() - start
        };
    }
}

export async function fetchAvailableModels(baseUrl: string, apiKey?: string): Promise<string[]> {
    const endpoint = getModelsEndpoint(baseUrl);

    try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const res = await fetch(endpoint, { headers });
        if (!res.ok) return [];
        const data = (await res.json()) as ModelsApiResponse;
        if (!Array.isArray(data?.data)) return [];
        return data.data
            .map((m) => (typeof m === "string" ? m : m?.id))
            .filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch {
        return [];
    }
}
