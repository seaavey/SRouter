import { PERCH_APP_URL } from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "@srouter/types";
import { parseDataLine, streamLines } from "./base.js";
import { fetchWithRetry } from "./retry.js";

export interface PerchModelDefinition {
    id: string;
    name: string;
    description?: string;
}

export const PERCH_MODELS: PerchModelDefinition[] = [
    { id: "minimax-m3-free", name: "MiniMax M3 (Free)", description: "GMI / W&B hosted" },
    { id: "minimax-m3", name: "MiniMax M3", description: "Standard / Pro" },
    { id: "minimax-m2", name: "MiniMax M2", description: "Bedrock Mantle" },
    { id: "qwen-3.6", name: "Qwen 3.6", description: "W&B Hosted" },
    { id: "qwen3-coder", name: "Qwen3 Coder", description: "W&B Hosted" },
    { id: "kimi-2.5", name: "Kimi K2.5", description: "Hosted" },
    { id: "kimi-2.6", name: "Kimi K2.6", description: "Hosted" },
    { id: "kimi-2.7", name: "Kimi K2.7 Code", description: "Hosted" },
    { id: "glm-5", name: "GLM 5", description: "Hosted" },
    { id: "glm-5.2", name: "GLM 5.2", description: "Hosted" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "Fireworks / Novita" },
    { id: "nemotron-super", name: "Nemotron Super", description: "Bedrock Mantle" }
];

export interface PerchExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    accessToken?: string;
    apiKey?: string;
}

function stripProviderPrefix(model: string): string {
    const slash = model.indexOf("/");
    return slash >= 0 ? model.slice(slash + 1) : model;
}

export class PerchExecutor implements AIProvider {
    id: string;
    name: string;
    private baseUrl: string;
    private accessToken: string;
    private apiKey: string;

    constructor(options: PerchExecutorOptions = {}) {
        this.id = options.id ?? "perch";
        this.name = options.name ?? "Perch AI";
        this.baseUrl = (options.baseUrl ?? PERCH_APP_URL).replace(/\/$/, "");
        this.accessToken = options.accessToken ?? "";
        this.apiKey = options.apiKey ?? "";
    }

    updateToken(accessToken: string): void {
        if (accessToken) {
            this.accessToken = accessToken;
        }
    }

    private getHeaders(): Record<string, string> {
        const token = this.accessToken || this.apiKey;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "SRouter/1.0.0 (Node.js)",
            "Accept-Encoding": "identity",
            Accept: "application/json"
        };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    async listModels(): Promise<ModelObject[]> {
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        return PERCH_MODELS.map((m) => ({
            id: `${baseId}/${m.id}`,
            object: "model",
            owned_by: baseId
        }));
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const targetModel = stripProviderPrefix(req.model);
        const endpoint = `${this.baseUrl}/api/perch-terminal/model-call`;

        const payload = {
            request: {
                messages: req.messages,
                temperature: req.temperature,
                max_tokens: req.max_tokens,
                tools: req.tools,
                tool_choice: req.tool_choice
            },
            lane: "chat",
            strictManual: false,
            preferredModelId: targetModel,
            clientSurface: "cli"
        };

        const res = await fetchWithRetry(endpoint, payload, this.getHeaders());
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Perch API error (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as Record<string, unknown>;
        if (data.ok === false) {
            throw new Error(`Perch error: ${String(data.error ?? "unknown error")}`);
        }

        const completionText = typeof data.text === "string" ? data.text : "";
        return {
            id: `chatcmpl-perch-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: req.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: completionText
                    },
                    finish_reason: "stop"
                }
            ],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        };
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const targetModel = stripProviderPrefix(req.model);
        const endpoint = `${this.baseUrl}/api/perch-terminal/model-call`;

        const payload = {
            request: {
                messages: req.messages,
                temperature: req.temperature,
                max_tokens: req.max_tokens,
                tools: req.tools,
                tool_choice: req.tool_choice
            },
            lane: "chat",
            strictManual: false,
            preferredModelId: targetModel,
            clientSurface: "cli"
        };

        const headers = { ...this.getHeaders(), Accept: "text/event-stream" };
        const res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Perch API error (${res.status}): ${errText}`);
        }

        if (!res.body) {
            throw new Error("No response body for streaming");
        }

        const streamId = `chatcmpl-perch-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        for await (const line of streamLines(res.body)) {
            const dataStr = parseDataLine(line);
            if (!dataStr || dataStr === "[DONE]") {
                continue;
            }

            try {
                const parsed = JSON.parse(dataStr) as Record<string, unknown>;
                if (parsed.type === "done") {
                    yield {
                        id: streamId,
                        object: "chat.completion.chunk",
                        created,
                        model: req.model,
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: "stop"
                            }
                        ]
                    };
                    break;
                }

                if (parsed.type === "answer_delta" && typeof parsed.text === "string") {
                    yield {
                        id: streamId,
                        object: "chat.completion.chunk",
                        created,
                        model: req.model,
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    content: parsed.text
                                },
                                finish_reason: null
                            }
                        ]
                    };
                }
            } catch {
                // Ignore parse errors on SSE events
            }
        }
    }
}
