import {
    ANTIGRAVITY_BASE_URL,
    ANTIGRAVITY_IDE_BASE_URL,
    ANTIGRAVITY_MODELS
} from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "@srouter/types";
import {
    ANTIGRAVITY_IDE_USER_AGENT,
    accumulateChunks,
    buildAntigravityContents,
    buildAntigravityEnvelope,
    buildAntigravityTools,
    createGeminiStreamState,
    generateProjectId,
    generateSessionId,
    geminiStreamToOpenAIChunks,
    getAntigravityModelFallbacks,
    isImageModel,
    parseAntigravityModelName,
    parseImageConfig,
    parseRetryFromErrorMessage,
    resolveAntigravityOutputCap,
    stripBlacklistedRequest
} from "@srouter/translator";
import { OpenAIExecutor } from "./openai.js";
import { parseDataLine, streamLines } from "./base.js";
import { fetchWithRetry } from "./retry.js";

export interface AntigravityExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    projectId?: string;
    enabledCreditTypes?: string[];
    creditsMode?: "never" | "on_demand" | "always";
}

/**
 * Antigravity Executor — Google Antigravity IDE backend (daily-cloudcode-pa).
 * Ported from 9router / OmniRoute open-sse/executors/antigravity.
 * Features:
 * - Pro fallback cascade chain on HTTP 400 Bad Request
 * - Google One AI paid credits fallback / mode on quota exhaustion (429)
 * - Trailing assistant turn stripper & competing agent prompt sanitizer
 * - Output token cap clamping (prevents 400 on oversized max_tokens)
 * - Zero-width character stripping and textual tool call parsing
 * - Falls back to OpenAI-compatible endpoint for local proxy / AIzaSy API keys.
 */
export class AntigravityExecutor implements AIProvider {
    id: string;
    name: string;
    category = "oauth" as const;
    protocol = "openai" as const;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private refreshToken?: string;
    private projectId: string;
    private sessionId: string;
    private enabledCreditTypes?: string[];
    private creditsMode: "never" | "on_demand" | "always";
    private remainingCredits?: Array<{ creditType: string; creditAmount: string }>;
    private openaiFallback: OpenAIExecutor;

    constructor(options: AntigravityExecutorOptions = {}) {
        this.id = options.id ?? "antigravity";
        this.name = options.name ?? "Antigravity Provider";
        this.baseUrl = (options.baseUrl ?? ANTIGRAVITY_IDE_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
        this.refreshToken = options.refreshToken;
        this.projectId = options.projectId ?? generateProjectId();
        this.sessionId = generateSessionId();
        this.enabledCreditTypes = options.enabledCreditTypes;
        this.creditsMode = options.creditsMode ?? "on_demand";
        this.openaiFallback = new OpenAIExecutor({
            id: this.id,
            name: this.name,
            baseUrl: options.baseUrl || ANTIGRAVITY_BASE_URL,
            apiKey: options.apiKey,
            accessToken: this.accessToken
        });
    }

    /**
     * Update tokens after a refresh — called by TokenRefreshService.
     */
    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) {
            this.accessToken = accessToken;
            this.openaiFallback.updateToken(accessToken);
        }
        if (refreshToken) this.refreshToken = refreshToken;
    }

    getRemainingCredits(): Array<{ creditType: string; creditAmount: string }> | undefined {
        return this.remainingCredits;
    }

    private getHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": ANTIGRAVITY_IDE_USER_AGENT
        };
        const token = this.accessToken || this.apiKey;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
            if (token.startsWith("AIzaSy")) {
                headers["x-goog-api-key"] = token;
            } else if (token.startsWith("ya29.")) {
                headers["x-goog-api-client"] = "gl-node/18.0.0 gd/1.0.0";
            }
        }
        if (extra) {
            Object.assign(headers, extra);
        }
        return headers;
    }

    private isLocalProxy(): boolean {
        return (
            /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(this.baseUrl) ||
            /^https?:\/\/localhost(:\d+)?(\/|$)/.test(this.baseUrl)
        );
    }

    private isApiKey(): boolean {
        const token = this.accessToken || this.apiKey;
        return token.startsWith("AIzaSy");
    }

    private getToken(): string {
        return this.accessToken || this.apiKey;
    }

    async listModels(): Promise<ModelObject[]> {
        const token = this.getToken();
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        // 1. OpenAI-compatible endpoint (local proxy or AIzaSy key on /openai base)
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.listModels();
        }

        // 2. Return the official Antigravity exposed models
        if (token) {
            return ANTIGRAVITY_MODELS.map((m) => ({
                id: m.id,
                object: "model" as const,
                created: Math.floor(Date.now() / 1000),
                owned_by: "antigravity"
            }));
        }

        return [];
    }

    private getAntigravityBaseUrl(): string {
        if (
            !this.baseUrl ||
            this.baseUrl.includes("generativelanguage.googleapis.com") ||
            this.baseUrl.includes("cloudcode-pa.googleapis.com") ||
            this.baseUrl === ANTIGRAVITY_BASE_URL
        ) {
            return ANTIGRAVITY_IDE_BASE_URL;
        }
        return this.baseUrl.replace(/\/openai$/, "").replace(/\/$/, "");
    }

    /**
     * Build the Antigravity request envelope + sanitized request body.
     */
    private buildRequest(
        model: string,
        req: ChatCompletionRequest,
        stream: boolean,
        enabledCreditTypes?: string[]
    ): { url: string; body: Record<string, unknown> } {
        const cleanBaseUrl = this.getAntigravityBaseUrl();
        const modelName = parseAntigravityModelName(model);

        // Build contents (with tool support, prompt stripping, zero-width stripping, trailing turn stripping)
        const contents = buildAntigravityContents(req);

        // ─── Image generation: different request structure ───
        if (isImageModel(modelName)) {
            const imageConfig = parseImageConfig(modelName);
            const cleanModel = modelName.replace(/-\d+x\d+$/, "");
            const request: Record<string, unknown> = {
                contents,
                generationConfig: {
                    temperature: 1.0,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 8192,
                    imageConfig
                },
                sessionId: this.sessionId
            };
            const envelope = buildAntigravityEnvelope({
                projectId: this.projectId,
                model: cleanModel,
                requestType: "image_gen",
                request,
                body: req as unknown as { requestId?: string },
                sessionId: this.sessionId,
                enabledCreditTypes
            });
            // Image gen MUST use non-streaming generateContent
            const url = `${cleanBaseUrl}/v1internal:generateContent`;
            return { url, body: envelope };
        }

        // ─── Standard request ───
        const tools = buildAntigravityTools(req);
        const maxCap = resolveAntigravityOutputCap(modelName);
        const requestedMaxTokens = typeof req.max_tokens === "number" ? req.max_tokens : undefined;
        const maxOutputTokens = requestedMaxTokens ? Math.min(requestedMaxTokens, maxCap) : maxCap;

        const request: Record<string, unknown> = {
            contents,
            sessionId: this.sessionId,
            safetySettings: undefined,
            generationConfig: {
                maxOutputTokens,
                topP: typeof req.top_p === "number" ? req.top_p : 1.0,
                topK: 40,
                ...(typeof req.temperature === "number" && { temperature: req.temperature })
            }
        };
        if (tools.length > 0) {
            request.tools = tools;
            request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
        }

        stripBlacklistedRequest(request);

        const envelope = buildAntigravityEnvelope({
            projectId: this.projectId,
            model: modelName,
            requestType: "agent",
            request,
            body: req as unknown as { requestId?: string },
            sessionId: this.sessionId,
            enabledCreditTypes
        });

        const url = stream
            ? `${cleanBaseUrl}/v1internal:streamGenerateContent?alt=sse`
            : `${cleanBaseUrl}/v1internal:generateContent`;

        return { url, body: envelope };
    }

    private async ensureProjectId(): Promise<string> {
        if (
            this.projectId &&
            !this.projectId.includes("-core-") &&
            !this.projectId.includes("-flow-")
        ) {
            return this.projectId;
        }
        const token = this.getToken();
        if (token && token.startsWith("ya29.")) {
            try {
                const res = await fetch(
                    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
                    {
                        method: "POST",
                        headers: this.getHeaders(),
                        body: JSON.stringify({})
                    }
                );
                if (res.ok) {
                    const data = (await res.json()) as {
                        cloudaicompanionProject?: string;
                        projectId?: string;
                    };
                    const fetchedProject = data.cloudaicompanionProject || data.projectId;
                    if (fetchedProject) {
                        this.projectId = fetchedProject;
                        return fetchedProject;
                    }
                }
            } catch {
                // fall back to default
            }
        }
        return this.projectId;
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        // 1. OpenAI-compatible fallback
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.chatCompletion(req);
        }

        // 2. Native Antigravity — accumulate stream for non-streaming callers
        const chunks: ChatCompletionChunk[] = [];
        for await (const chunk of this.chatCompletionStream(req)) {
            chunks.push(chunk);
        }
        return accumulateChunks(chunks, req.model);
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            yield* this.openaiFallback.chatCompletionStream(req);
            return;
        }

        await this.ensureProjectId();

        const modelFallbacks = getAntigravityModelFallbacks(req.model);
        let lastError: Error | null = null;

        for (let i = 0; i < modelFallbacks.length; i++) {
            const candidateModel = modelFallbacks[i] ?? req.model;
            try {
                yield* this.streamCandidateWithCreditRetry(candidateModel, req);
                return;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                // Only retry next candidate if HTTP 400 (Bad Request) and not the last candidate
                const is400 = lastError.message.includes("(400)");
                if (is400 && i < modelFallbacks.length - 1) {
                    continue;
                }
                throw lastError;
            }
        }

        if (lastError) throw lastError;
    }

    private async *streamCandidateWithCreditRetry(
        model: string,
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const useCreditsFirst =
            this.creditsMode === "always" ||
            (this.enabledCreditTypes && this.enabledCreditTypes.includes("GOOGLE_ONE_AI"));

        let currentCreditTypes = useCreditsFirst ? ["GOOGLE_ONE_AI"] : this.enabledCreditTypes;
        let creditsRetryAttempted = Boolean(useCreditsFirst);

        try {
            yield* this.executeStreamAttempt(model, req, currentCreditTypes);
        } catch (err: unknown) {
            const errStr = err instanceof Error ? err.message : String(err);
            const is429 = errStr.includes("(429)");
            const isQuotaExhausted =
                errStr.includes("RESOURCE_EXHAUSTED") ||
                errStr.includes("quota_exhausted") ||
                errStr.includes("reset after") ||
                errStr.includes("Resets in");

            const shouldRetryCredits =
                (is429 || isQuotaExhausted) &&
                this.creditsMode !== "never" &&
                !creditsRetryAttempted;

            if (shouldRetryCredits) {
                creditsRetryAttempted = true;
                currentCreditTypes = ["GOOGLE_ONE_AI"];
                yield* this.executeStreamAttempt(model, req, currentCreditTypes);
                return;
            }

            throw err;
        }
    }

    private async *executeStreamAttempt(
        model: string,
        req: ChatCompletionRequest,
        enabledCreditTypes?: string[]
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const { url, body } = this.buildRequest(model, req, true, enabledCreditTypes);
        const streamUrl = url.includes("?") ? url : `${url}?alt=sse`;
        const res = await fetchWithRetry(streamUrl, body, this.getHeaders());

        if (!res.ok) {
            const errorText = await res.text();
            const retryMs = parseRetryFromErrorMessage(errorText);
            const retryHint = retryMs ? ` [Retry-After: ~${Math.ceil(retryMs / 1000)}s]` : "";
            throw new Error(`Antigravity Provider Error (${res.status}): ${errorText}${retryHint}`);
        }

        if (!res.body) {
            throw new Error("No response body received for streaming");
        }

        const state = createGeminiStreamState(req.model);
        for await (const line of streamLines(res.body)) {
            const jsonStr = parseDataLine(line);
            if (jsonStr === null) continue;
            try {
                const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
                const chunks = geminiStreamToOpenAIChunks(parsed, state);
                if (chunks) {
                    for (const chunk of chunks) yield chunk;
                }
            } catch {
                // ignore malformed JSON
            }
        }

        if (state.remainingCredits) {
            this.remainingCredits = state.remainingCredits;
        }
    }
}
