export interface ServerHealthResult {
    healthy: boolean;
    modelsCount: number;
    error?: string;
    latencyMs?: number;
}

export function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, "");
}

export function getModelsEndpoint(baseUrl: string): string {
    const cleanUrl = normalizeBaseUrl(baseUrl);
    return cleanUrl.endsWith("/v1") ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;
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
                modelsCount: 0,
                error: `HTTP ${res.status}: ${res.statusText}`,
                latencyMs: Date.now() - start
            };
        }

        const data = (await res.json()) as any;
        const models = Array.isArray(data?.data) ? data.data : [];

        return {
            healthy: true,
            modelsCount: models.length,
            latencyMs: Date.now() - start
        };
    } catch (err: any) {
        return {
            healthy: false,
            modelsCount: 0,
            error: err.name === "AbortError" ? "Connection timeout" : err.message,
            latencyMs: Date.now() - start
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
        const data = (await res.json()) as any;
        if (!Array.isArray(data?.data)) return [];
        return data.data
            .map((m: any) => (typeof m === "string" ? m : m?.id))
            .filter((id: any): id is string => typeof id === "string" && id.length > 0);
    } catch {
        return [];
    }
}
