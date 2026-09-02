import { OPENAI_BASE_URL } from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelListResponse,
    ModelObject
} from "@srouter/types";
import { parseDataLine, streamLines } from "./base.js";
import { fetchWithRetry } from "./retry.js";

function stripProviderPrefix(model: string): string {
    const slash = model.indexOf("/");
    return slash >= 0 ? model.slice(slash + 1) : model;
}

export interface OpenAIExecutorOptions {
    id?: string;
    name?: string;
    alias?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
}

export class OpenAIExecutor implements AIProvider {
    id: string;
    name: string;
    alias?: string;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;

    constructor(options: OpenAIExecutorOptions = {}) {
        this.id = options.id ?? "openai";
        this.name = options.name ?? "OpenAI Provider";
        this.alias = options.alias;
        this.baseUrl = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
    }

    /**
     * Update tokens after a refresh — called by TokenRefreshService.
     */
    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) this.accessToken = accessToken;
    }

    private getHeaders(accept?: string): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "SRouter/1.0.0 (Node.js)",
            "Accept-Encoding": "identity",
            Accept: accept ?? "application/json"
        };
        const token = this.accessToken || this.apiKey;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
            if (token.startsWith("AIzaSy")) {
                headers["x-goog-api-key"] = token;
            } else if (token.startsWith("ya29.")) {
                headers["User-Agent"] = "Antigravity/1.0 (VSCode)";
                headers["x-goog-api-client"] = "gl-node/18.0.0 gd/1.0.0";
            }
        }
        return headers;
    }

    async listModels(): Promise<ModelObject[]> {
        try {
            const res = await fetch(`${this.baseUrl}/models`, {
                method: "GET",
                headers: this.getHeaders()
            });
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as ModelListResponse;
            if (!data.data || !Array.isArray(data.data)) {
                return [];
            }
            const baseId = (this.alias || this.id.split("_")[0]?.split("-")[0]) ?? this.id;
            return data.data.map((m) => ({
                id: `${baseId}/${m.id}`,
                object: "model",
                owned_by: baseId
            }));
        } catch {
            return [];
        }
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const targetModel = stripProviderPrefix(req.model);

        const res = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { ...req, model: targetModel, stream: false },
            this.getHeaders()
        );

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI Provider Error (${res.status}): ${errorText}`);
        }

        return (await res.json()) as ChatCompletionResponse;
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const targetModel = stripProviderPrefix(req.model);

        const res = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { ...req, model: targetModel, stream: true },
            this.getHeaders("text/event-stream, application/json, */*")
        );

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI Provider Stream Error (${res.status}): ${errorText}`);
        }

        if (!res.body) {
            throw new Error("No response body received for streaming");
        }

        for await (const line of streamLines(res.body)) {
            const jsonStr = parseDataLine(line);
            if (jsonStr === null) continue;
            try {
                const parsed = JSON.parse(jsonStr) as ChatCompletionChunk;
                yield parsed;
            } catch {
                // ignore malformed JSON chunk
            }
        }
    }
}
