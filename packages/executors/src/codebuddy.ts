import { CODEBUDDY_BASE_URL, CODEBUDDY_MODELS } from "@srouter/constants";
import { accumulateChunks } from "@srouter/translator";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "@srouter/types";
import { parseDataLine, streamLines } from "./base.js";

function stripProviderPrefix(model: string): string {
    const slash = model.indexOf("/");
    return slash >= 0 ? model.slice(slash + 1) : model;
}

export interface CodeBuddyExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    modelPrefix?: string;
    domain?: string;
    userAgent?: string;
    /** Header profile: "cli" identifies as the CodeBuddy CLI (X-IDE-Type: CLI), "ide" as the IDE plugin */
    flavor?: "ide" | "cli";
}

export class CodeBuddyExecutor implements AIProvider {
    id: string;
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private modelPrefix: string;
    private domain?: string;
    private userAgent: string;
    private flavor: "ide" | "cli";

    constructor(options: CodeBuddyExecutorOptions = {}) {
        this.id = options.id ?? "codebuddy";
        this.name = options.name ?? "CodeBuddy Provider";
        this.baseUrl = (options.baseUrl ?? CODEBUDDY_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
        this.modelPrefix = options.modelPrefix ?? this.id.split("_")[0]?.split("-")[0] ?? this.id;
        this.domain = options.domain;
        this.userAgent = options.userAgent ?? "IDE/2.108.1 CodeBuddy/2.108.1";
        this.flavor = options.flavor ?? "ide";
    }

    updateToken(accessToken: string): void {
        if (accessToken) this.accessToken = accessToken;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": this.userAgent
        };
        const ideName = this.flavor === "cli" ? "CLI" : "IDE";
        headers["X-Product"] = "SaaS";
        headers["X-IDE-Type"] = ideName;
        headers["X-IDE-Name"] = ideName;
        headers["x-requested-with"] = "XMLHttpRequest";
        headers["x-codebuddy-request"] = "1";
        if (this.domain) headers["X-Domain"] = this.domain;
        const token = this.accessToken || this.apiKey;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    private getChatUrl(): string {
        if (this.baseUrl.endsWith("/chat/completions")) {
            return this.baseUrl;
        }
        if (this.baseUrl.endsWith("/v2")) {
            return `${this.baseUrl}/chat/completions`;
        }
        return `${this.baseUrl}/v2/chat/completions`;
    }

    private transformRequestBody(req: ChatCompletionRequest): Record<string, unknown> {
        const targetModel = stripProviderPrefix(req.model);
        const transformed: Record<string, unknown> = {
            ...req,
            model: targetModel,
            stream: true // CodeBuddy requires stream: true
        };

        // Handle reasoning effort
        const eff = (req as unknown as { reasoning_effort?: unknown }).reasoning_effort;
        if (eff === "none" || eff === "off") {
            delete transformed.reasoning_effort;
        } else if (eff) {
            transformed.reasoning_summary = "auto";
        }

        // CodeBuddy requires a leading system prompt and typed blocks for user content.
        // If the caller provided their own system/developer prompt, preserve it alongside CodeBuddy's identity.
        const source = Array.isArray(req.messages) ? req.messages : [];
        const systemPrompts: string[] = [];
        for (const m of source) {
            if (m && typeof m === "object" && ["system", "developer"].includes((m as { role?: string }).role ?? "")) {
                const content = (m as { content?: unknown }).content;
                if (typeof content === "string" && content.trim()) {
                    systemPrompts.push(content.trim());
                }
            }
        }

        const combinedSystem = systemPrompts.length > 0
            ? `You are CodeBuddy Code.\n\n${systemPrompts.join("\n\n")}`
            : "You are CodeBuddy Code.";

        const messages: unknown[] = [{ role: "system", content: combinedSystem }];

        for (const message of source) {
            if (
                !message ||
                typeof message !== "object" ||
                ["system", "developer"].includes((message as { role?: string }).role ?? "")
            ) {
                continue;
            }
            if (
                (message as { role?: string }).role === "user" &&
                typeof (message as { content?: unknown }).content === "string"
            ) {
                messages.push({
                    ...message,
                    content: [{ type: "text", text: (message as { content: string }).content }]
                });
            } else {
                messages.push({ ...message });
            }
        }

        transformed.messages = messages;
        return transformed;
    }

    async listModels(): Promise<ModelObject[]> {
        return CODEBUDDY_MODELS.map((m) => ({
            id: `${this.modelPrefix}/${m.id}`,
            object: "model",
            owned_by: this.modelPrefix
        }));
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        // CodeBuddy upstream is stream-only (forceStream). Run the stream and
        // accumulate the final response for non-streaming callers.
        const chunks: ChatCompletionChunk[] = [];
        for await (const chunk of this.chatCompletionStream(req)) {
            chunks.push(chunk);
        }
        return accumulateChunks(chunks, req.model);
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const body = this.transformRequestBody(req);
        const res = await fetch(this.getChatUrl(), {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`CodeBuddy Provider Error (${res.status}): ${errorText}`);
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
                // ignore malformed chunk
            }
        }
    }
}
