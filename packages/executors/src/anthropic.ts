import { ANTHROPIC_BASE_URL } from "@srouter/constants";
import type {
    AIProvider,
    AnthropicMessageResponse,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "@srouter/types";
import {
    AnthropicEventToOpenAIChunk,
    AnthropicToOpenAIResponse,
    OpenAIToAnthropicRequest
} from "@srouter/translator";
import { parseDataLine, streamLines } from "./base.js";

export interface AnthropicExecutorOptions {
    id?: string;
    name?: string;
    alias?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    organizationId?: string;
}

// Anthropic-Beta flags — base for all models, heavy-agent flags gated to opus/sonnet
// (port of 9router providers/shared.js selectAnthropicBeta)
const ANTHROPIC_BETA_BASE = [
    "claude-code-20250219",
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "structured-outputs-2025-12-15",
    "fast-mode-2026-02-01",
    "redact-thinking-2026-02-12",
    "token-efficient-tools-2026-03-28"
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

export function selectAnthropicBeta(model = ""): string {
    const flags = [...ANTHROPIC_BETA_BASE];
    if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
    return flags.join(",");
}

// Full Claude CLI fingerprint — required by providers that gate on client identity
const CLAUDE_CLI_SPOOF_HEADERS: Record<string, string> = {
    "Anthropic-Dangerous-Direct-Browser-Access": "true",
    "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
    "X-App": "cli",
    "X-Stainless-Helper-Method": "stream",
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime-Version": "v24.14.0",
    "X-Stainless-Package-Version": "0.80.0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Lang": "js",
    "X-Stainless-Arch": "arm64",
    "X-Stainless-Os": "MacOS",
    "X-Stainless-Timeout": "600"
};

export class AnthropicExecutor implements AIProvider {
    id: string;
    name: string;
    alias?: string;
    category: "api_key" | "oauth" = "api_key";
    protocol: "anthropic" = "anthropic";
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private refreshToken?: string;
    private organizationId?: string;

    constructor(options: AnthropicExecutorOptions = {}) {
        this.id = options.id ?? "anthropic";
        this.name = options.name ?? "Anthropic Provider";
        this.alias = options.alias;
        this.baseUrl = (options.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
        this.accessToken = options.accessToken ?? process.env.ANTHROPIC_ACCESS_TOKEN ?? "";
        this.refreshToken = options.refreshToken;
        this.organizationId = options.organizationId;
        if (this.accessToken) {
            this.category = "oauth";
        }
    }

    updateToken(accessToken: string, refreshToken?: string): void {
        this.accessToken = accessToken;
        if (refreshToken) this.refreshToken = refreshToken;
    }

    private getHeaders(model?: string, stream = false): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "Anthropic-Beta": selectAnthropicBeta(model || "")
        };

        if (this.accessToken) {
            // OAuth account — Bearer token + CLI identity headers
            headers["Authorization"] = `Bearer ${this.accessToken}`;
            Object.assign(headers, CLAUDE_CLI_SPOOF_HEADERS);
            if (this.organizationId) {
                headers["anthropic-organization-id"] = this.organizationId;
            }
        } else if (this.apiKey) {
            headers["x-api-key"] = this.apiKey;
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        if (stream) {
            headers["Accept"] = "text/event-stream";
        }

        return headers;
    }

    /**
     * Dynamically fetches official model list from Anthropic API (https://api.anthropic.com/v1/models)
     */
    async listModels(): Promise<ModelObject[]> {
        try {
            const res = await fetch(`${this.baseUrl}/models`, {
                method: "GET",
                headers: this.getHeaders()
            });

            if (!res.ok) {
                return [];
            }

            const json = (await res.json()) as {
                data?: Array<{
                    id: string;
                    created_at?: string;
                    display_name?: string;
                }>;
            };

            if (json.data && Array.isArray(json.data)) {
                const baseId = this.alias || "anthropic";
                return json.data.map((m) => ({
                    id: `${baseId}/${m.id}`,
                    object: "model",
                    created: m.created_at
                        ? Math.floor(new Date(m.created_at).getTime() / 1000)
                        : Math.floor(Date.now() / 1000),
                    owned_by: baseId
                }));
            }

            return [];
        } catch {
            return [];
        }
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const anthropicReq = OpenAIToAnthropicRequest(req);
        anthropicReq.stream = false;
        const targetModel = req.model.includes("/")
            ? (req.model.split("/")[1] ?? req.model)
            : req.model;
        anthropicReq.model = targetModel;

        const res = await fetch(`${this.baseUrl}/messages`, {
            method: "POST",
            headers: this.getHeaders(targetModel, false),
            body: JSON.stringify(anthropicReq)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Anthropic API Error (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as AnthropicMessageResponse;
        return AnthropicToOpenAIResponse(data, req.model);
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const anthropicReq = OpenAIToAnthropicRequest(req);
        anthropicReq.stream = true;
        const targetModel = req.model.includes("/")
            ? (req.model.split("/")[1] ?? req.model)
            : req.model;
        anthropicReq.model = targetModel;

        const res = await fetch(`${this.baseUrl}/messages`, {
            method: "POST",
            headers: this.getHeaders(targetModel, true),
            body: JSON.stringify(anthropicReq)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Anthropic API Stream Error (${res.status}): ${errorText}`);
        }

        if (!res.body) {
            throw new Error("No response body received from Anthropic");
        }

        let currentEventType = "";

        for await (const line of streamLines(res.body)) {
            if (line.startsWith("event: ")) {
                currentEventType = line.slice(7);
                continue;
            }

            const jsonStr = parseDataLine(line);
            if (jsonStr === null) continue;
            try {
                const parsedJson = JSON.parse(jsonStr);
                const chunk = AnthropicEventToOpenAIChunk(currentEventType, parsedJson, req.model);
                if (chunk) {
                    yield chunk;
                }
            } catch {
                // ignore malformed SSE line
            }
        }
    }
}
