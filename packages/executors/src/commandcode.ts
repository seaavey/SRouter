import { randomUUID } from "node:crypto";
import { COMMANDCODE_BASE_URL, COMMANDCODE_MODELS_URL } from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelListResponse,
    ModelObject
} from "@srouter/types";
import {
    accumulateChunks,
    buildRequestBody,
    commandCodeEventToOpenAIChunk,
    createCommandCodeStreamState,
    type CommandCodeEvent
} from "@srouter/translator";
import { parseDataLine, streamLines } from "./base.js";

export interface CommandCodeExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
}

export class CommandCodeExecutor implements AIProvider {
    id: string;
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;

    constructor(options: CommandCodeExecutorOptions = {}) {
        this.id = options.id ?? "commandcode";
        this.name = options.name ?? "Command Code Provider";
        this.baseUrl = (options.baseUrl ?? COMMANDCODE_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-command-code-version": "0.25.7",
            "x-cli-environment": "cli",
            "x-session-id": randomUUID()
        };
        const token = this.accessToken || this.apiKey;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    private getModelsUrl(): string {
        if (
            this.baseUrl === COMMANDCODE_BASE_URL ||
            this.baseUrl.startsWith("https://api.commandcode.ai")
        ) {
            return COMMANDCODE_MODELS_URL;
        }
        if (this.baseUrl.endsWith("/alpha/generate")) {
            return this.baseUrl.replace(/\/alpha\/generate$/, "/provider/v1/models");
        }
        return `${this.baseUrl}/models`;
    }

    async listModels(): Promise<ModelObject[]> {
        try {
            const res = await fetch(this.getModelsUrl(), {
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

            const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
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
        // CommandCode upstream is streaming-only (forceStream). Run the stream and
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
        const body = buildRequestBody(req);
        const res = await fetch(this.baseUrl, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`CommandCode Provider Error (${res.status}): ${errorText}`);
        }

        if (!res.body) {
            throw new Error("No response body received for streaming");
        }

        const state = createCommandCodeStreamState();

        for await (const line of streamLines(res.body)) {
            const jsonStr = parseDataLine(line);
            if (jsonStr === null) continue;
            let event: CommandCodeEvent;
            try {
                event = JSON.parse(jsonStr) as CommandCodeEvent;
            } catch {
                continue;
            }
            for (const chunk of commandCodeEventToOpenAIChunk(event, state)) {
                yield chunk;
            }
        }
    }
}
