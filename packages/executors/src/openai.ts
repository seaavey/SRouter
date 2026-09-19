import { OPENAI_BASE_URL } from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ImageGenerationRequest,
    ImageGenerationResponse,
    ModelListResponse,
    ModelObject,
    RequestAttemptBudget
} from "@srouter/types";
import {
    DescribeErrorPayload,
    parseDataLine,
    streamLines,
    type UpstreamErrorPayload
} from "./base.js";
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
    additionalHeaders?: Record<string, string>;
}

export class OpenAIExecutor implements AIProvider {
    id: string;
    name: string;
    alias?: string;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private additionalHeaders: Record<string, string>;

    constructor(options: OpenAIExecutorOptions = {}) {
        this.id = options.id ?? "openai";
        this.name = options.name ?? "OpenAI Provider";
        this.alias = options.alias;
        this.baseUrl = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
        this.additionalHeaders = options.additionalHeaders ?? {};
    }

    /**
     * Update tokens after a refresh — called by TokenRefreshService.
     */
    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) this.accessToken = accessToken;
    }

    protected getHeaders(accept?: string): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "SRouter/1.0.0 (Node.js)",
            "Accept-Encoding": "identity",
            Accept: accept ?? "application/json"
        };
        Object.assign(headers, this.additionalHeaders);
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

    /**
     * Last step before a decoded non-streaming payload reaches callers. Drivers
     * whose upstream wraps the OpenAI payload (the hosted Cline API answers with
     * `{ data, success }`) override this to unwrap the envelope.
     */
    protected NormalizeResponsePayload<T extends object>(payload: T): T {
        return payload;
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

    async chatCompletion(
        req: ChatCompletionRequest,
        budget?: RequestAttemptBudget
    ): Promise<ChatCompletionResponse> {
        const targetModel = stripProviderPrefix(req.model);

        const res = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { ...req, model: targetModel, stream: false },
            this.getHeaders(),
            3,
            budget
        );

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI Provider Error (${res.status}): ${errorText}`);
        }

        return this.NormalizeResponsePayload<ChatCompletionResponse>(await res.json());
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest,
        budget?: RequestAttemptBudget
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const targetModel = stripProviderPrefix(req.model);

        const res = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            {
                ...req,
                model: targetModel,
                stream: true,
                stream_options: {
                    ...req.stream_options,
                    include_usage: true
                }
            },
            this.getHeaders("text/event-stream, application/json, */*"),
            3,
            budget
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
            let parsed: ChatCompletionChunk & { error?: UpstreamErrorPayload };
            try {
                parsed = JSON.parse(jsonStr) as ChatCompletionChunk & {
                    error?: UpstreamErrorPayload;
                };
            } catch {
                // ignore malformed JSON chunk
                continue;
            }
            // Gateways report mid-stream failures as an error frame instead of a
            // chunk; yielding it would truncate the response without any signal.
            if (parsed.error !== undefined && parsed.error !== null) {
                throw new Error(
                    `OpenAI Provider Stream Error: ${DescribeErrorPayload(parsed.error)}`
                );
            }
            yield parsed;
        }
    }

    async generateImage(
        req: ImageGenerationRequest,
        budget?: RequestAttemptBudget
    ): Promise<ImageGenerationResponse> {
        const targetModel = stripProviderPrefix(req.model);
        const payload = { ...req, model: targetModel };

        // If img2img parameters (image or mask) are provided, upstream may route to /images/edits
        const endpoint =
            req.image || req.images || req.mask
                ? `${this.baseUrl}/images/edits`
                : `${this.baseUrl}/images/generations`;

        const res = await fetchWithRetry(endpoint, payload, this.getHeaders(), 3, budget);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI Provider Image Error (${res.status}): ${errorText}`);
        }

        return this.NormalizeResponsePayload<ImageGenerationResponse>(await res.json());
    }
}
