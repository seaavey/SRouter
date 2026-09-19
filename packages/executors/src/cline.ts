import { randomUUID } from "node:crypto";
import type { ModelListResponse, ModelObject } from "@srouter/types";
import { CLINE_BASE_URL } from "@srouter/constants";
import { DescribeErrorPayload, type UpstreamErrorPayload } from "./base.js";
import { OpenAIExecutor, type OpenAIExecutorOptions } from "./openai.js";

export interface ClineExecutorOptions extends OpenAIExecutorOptions {
    refreshToken?: string;
}

/** Successful hosted API payloads arrive wrapped as `{ data, success: true }`. */
export interface ClineSuccessEnvelope<T> {
    data: T;
    success: true;
}

/** Rejected payloads arrive as `{ success: false }` plus the upstream error. */
export interface ClineErrorEnvelope {
    data?: UpstreamErrorPayload | null;
    success: false;
    error?: UpstreamErrorPayload;
}

interface ClineRecommendedModelsResponse {
    free?: Array<{ id?: string }>;
}

/** A non-streaming payload is either bare or wrapped by the hosted API. */
export type ClineResponsePayload<T> = T | ClineSuccessEnvelope<T> | ClineErrorEnvelope;

function IsClineEnvelope<T extends object>(
    payload: ClineResponsePayload<T>
): payload is ClineSuccessEnvelope<T> | ClineErrorEnvelope {
    if (typeof payload !== "object" || payload === null) return false;
    const candidate = payload as ClineSuccessEnvelope<T> | ClineErrorEnvelope;
    return "success" in candidate && typeof candidate.success === "boolean";
}

/**
 * The hosted Cline API answers non-streaming requests with a `{ data, success }`
 * envelope (`{"data":{"choices":[...]},"success":true}`) while its SSE frames
 * stay unwrapped. Every consumer downstream — the chat route, the Anthropic
 * `/v1/messages` translator, usage accounting — expects the bare OpenAI payload,
 * so unwrap the envelope here.
 */
export function UnwrapClineEnvelope<T extends object>(payload: ClineResponsePayload<T>): T {
    if (!IsClineEnvelope(payload)) return payload;
    if (payload.success) return payload.data;
    throw new Error(`Cline Provider Error: ${DescribeErrorPayload(payload.error ?? payload.data)}`);
}

export class ClineExecutor extends OpenAIExecutor {
    constructor(options: ClineExecutorOptions = {}) {
        super({
            ...options,
            id: options.id ?? "cline",
            name: options.name ?? "Cline",
            alias: options.alias ?? "cline",
            baseUrl: options.baseUrl ?? CLINE_BASE_URL,
            additionalHeaders: {
                "User-Agent": "Cline/3.0.62",
                "HTTP-Referer": "https://cline.bot",
                "X-Title": "Cline",
                "X-IS-MULTIROOT": "false",
                "X-CLIENT-TYPE": "cline-sdk",
                "X-CLIENT-VERSION": "3.0.62",
                "X-PLATFORM": "cli",
                "X-PLATFORM-VERSION": "3.0.62",
                "X-CORE-VERSION": "0.0.83",
                "X-Task-ID": randomUUID()
            }
        });
    }

    async listModels(): Promise<ModelObject[]> {
        const headers = this.getHeaders();
        const [modelsResponse, recommendedResponse] = await Promise.all([
            fetch(`${CLINE_BASE_URL}/models`, { method: "GET", headers }),
            fetch(`${CLINE_BASE_URL}/ai/cline/recommended-models`, {
                method: "GET",
                headers
            })
        ]);

        const modelIds = new Set<string>();
        if (modelsResponse.ok) {
            const payload = (await modelsResponse.json()) as ModelListResponse;
            if (Array.isArray(payload.data)) {
                for (const model of payload.data) modelIds.add(model.id);
            }
        }
        if (recommendedResponse.ok) {
            const payload = (await recommendedResponse.json()) as ClineRecommendedModelsResponse;
            for (const model of payload.free ?? []) {
                if (model.id) modelIds.add(model.id);
            }
        }

        return Array.from(modelIds, (id) => ({
            id: `cline/${id}`,
            object: "model" as const,
            owned_by: "cline"
        }));
    }

    protected NormalizeResponsePayload<T extends object>(payload: ClineResponsePayload<T>): T {
        return UnwrapClineEnvelope<T>(payload);
    }
}
