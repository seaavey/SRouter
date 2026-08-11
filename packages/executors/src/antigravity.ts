import type { AIProvider, ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ModelObject } from "@srouter/types";
import { OpenAIExecutor } from "./openai.js";

export interface AntigravityProviderOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
}

export class AntigravityProvider implements AIProvider {
    id: string;
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private openaiFallback: OpenAIExecutor;

    constructor(options: AntigravityProviderOptions = {}) {
        this.id = options.id ?? "antigravity";
        this.name = options.name ?? "Antigravity Provider";
        this.baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
        this.apiKey = options.apiKey ?? process.env.ANTIGRAVITY_API_KEY ?? "";
        this.accessToken = options.accessToken ?? process.env.ANTIGRAVITY_ACCESS_TOKEN ?? "";

        this.openaiFallback = new OpenAIExecutor({
            id: this.id,
            name: this.name,
            baseUrl: options.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey: this.apiKey,
            accessToken: this.accessToken,
        });
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
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
        const token = this.accessToken || this.apiKey;
        const isLocalProxy = /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(this.baseUrl) || /^https?:\/\/localhost(:\d+)?(\/|$)/.test(this.baseUrl);
        const isApiKey = token.startsWith("AIzaSy");

        // 1. OpenAI-compatible endpoint (local proxy or AIzaSy key on /openai base)
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.listModels();
        }

        // 2. Native Gemini models endpoint (https://generativelanguage.googleapis.com/v1beta/models)
        const cleanBaseUrl = this.baseUrl.replace(/\/openai$/, "");
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        const models: ModelObject[] = [];
        const seenIds = new Set<string>();

        const pushModel = (rawId: string): void => {
            const id = rawId.replace(/^models\//, "");
            if (seenIds.has(id)) return;
            seenIds.add(id);
            models.push({ id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "antigravity" });
            if (!id.startsWith(`${baseId}/`)) {
                models.push({ id: `${baseId}/${id}`, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "antigravity" });
            }
        };

        try {
            const res = await fetch(`${cleanBaseUrl}/models`, {
                method: "GET",
                headers: this.getHeaders(),
            });
            if (res.ok) {
                const json = (await res.json()) as { models?: Array<{ name?: string }> };
                if (json.models && Array.isArray(json.models)) {
                    for (const m of json.models) {
                        if (m.name) pushModel(m.name);
                    }
                    if (models.length > 0) return models;
                }
            }
        } catch {
            // fall through to CloudCode attempt
        }

        // 3. ya29 OAuth token: CloudCode fetchAvailableModels
        if (token.startsWith("ya29.")) {
            try {
                const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "User-Agent": "Antigravity/1.0 (VSCode)",
                        "x-goog-api-client": "gl-node/18.0.0 gd/1.0.0",
                    },
                    body: JSON.stringify({}),
                });
                if (res.ok) {
                    const data = (await res.json()) as { models?: Record<string, { displayName?: string }> };
                    if (data.models && Object.keys(data.models).length > 0) {
                        for (const modelId of Object.keys(data.models)) {
                            pushModel(modelId);
                        }
                        return models;
                    }
                }
            } catch {
                // no models available
            }
        }

        // 4. Never return hardcoded models — provider could not verify its model list
        return [];
    }

    private parseModelName(rawModel: string): string {
        let model = rawModel.includes("/") ? (rawModel.split("/")[1] ?? rawModel) : rawModel;
        if (model === "gemini-3.6-flash" || model === "gemini-3.5-flash" || model === "gemini-2.0-flash") {
            model = "gemini-2.5-flash";
        }
        return model;
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const token = this.accessToken || this.apiKey;
        const isLocalProxy = /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(this.baseUrl) || /^https?:\/\/localhost(:\d+)?(\/|$)/.test(this.baseUrl);
        const isApiKey = token.startsWith("AIzaSy");

        // 1. Only use openaiFallback if token is AIzaSy API key or connecting to local proxy
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.chatCompletion(req);
        }

        // 2. For Google OAuth ya29... tokens, use Native Gemini REST API
        const cleanBaseUrl = this.baseUrl.replace(/\/openai$/, "");
        const modelName = this.parseModelName(req.model);
        const contents = req.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        }));

        interface CloudCodePayload {
            model: string;
            request: {
                contents: Array<{ role: string; parts: Array<{ text: string }> }>;
            };
        }

        interface GeminiNativePayload {
            contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        }

        let targetUrl: string;
        let bodyPayload: CloudCodePayload | GeminiNativePayload;

        if (token.startsWith("ya29.")) {
            targetUrl = process.env.ANTIGRAVITY_BASE_URL || "https://cloudcode-pa.googleapis.com/v1internal:generateContent";
            bodyPayload = {
                model: modelName,
                request: {
                    contents,
                },
            };
        } else {
            const cleanBaseUrl = this.baseUrl.replace(/\/openai$/, "");
            targetUrl = `${cleanBaseUrl}/models/${modelName}:generateContent`;
            if (isApiKey) {
                targetUrl += `?key=${token}`;
            }
            bodyPayload = { contents };
        }

        const res = await fetch(targetUrl, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Antigravity Provider Error (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            candidates?: Array<{
                content?: {
                    parts?: Array<{ text?: string }>;
                    role?: string;
                };
                finishReason?: string;
            }>;
            responses?: Array<{
                candidates?: Array<{
                    content?: {
                        parts?: Array<{ text?: string }>;
                        role?: string;
                    };
                }>;
            }>;
            response?: {
                candidates?: Array<{
                    content?: {
                        parts?: Array<{ text?: string }>;
                        role?: string;
                    };
                }>;
            };
        };

        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? data.responses?.[0]?.candidates?.[0]?.content?.parts?.[0]?.text ?? data.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        return {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: req.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: textResponse,
                    },
                    finish_reason: "stop",
                },
            ],
        };
    }

    async *chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        const token = this.accessToken || this.apiKey;
        const isLocalProxy = /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(this.baseUrl) || /^https?:\/\/localhost(:\d+)?(\/|$)/.test(this.baseUrl);
        const isApiKey = token.startsWith("AIzaSy");

        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            yield* this.openaiFallback.chatCompletionStream(req);
            return;
        }

        const res = await this.chatCompletion(req);
        const rawContent = res.choices[0]?.message.content;
        const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent ?? "");

        yield {
            id: res.id,
            object: "chat.completion.chunk",
            created: res.created,
            model: req.model,
            choices: [
                {
                    index: 0,
                    delta: {
                        role: "assistant",
                        content: text,
                    },
                    finish_reason: "stop",
                },
            ],
        };
    }
}
