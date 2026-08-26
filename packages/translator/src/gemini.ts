import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse
} from "@srouter/types";
import crypto from "node:crypto";

export interface GeminiContentPart {
    text?: string;
    functionCall?: { name: string; args?: Record<string, unknown> };
    functionResponse?: { name: string; response?: Record<string, unknown> };
    thought?: boolean;
    thoughtSignature?: string;
    thought_signature?: string;
    inlineData?: { mimeType?: string; data?: string };
}

export interface GeminiContent {
    role: string;
    parts: GeminiContentPart[];
}

export interface CloudCodePayload {
    model: string;
    request: {
        contents: GeminiContent[];
    };
}

export interface GeminiNativePayload {
    contents: GeminiContent[];
}

export function parseGeminiModelName(rawModel: string): string {
    let model = rawModel.includes("/") ? (rawModel.split("/")[1] ?? rawModel) : rawModel;
    if (
        model === "gemini-3.6-flash" ||
        model === "gemini-3.5-flash" ||
        model === "gemini-2.0-flash"
    ) {
        model = "gemini-2.5-flash";
    }
    return model;
}

export function buildGeminiContents(req: ChatCompletionRequest): GeminiContent[] {
    return req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]
    }));
}

// CloudCode (ya29 OAuth) uses { model, request: { contents } }; Gemini native uses bare { contents }.
export function buildGeminiBody(
    contents: GeminiContent[],
    modelName: string,
    token: string
): CloudCodePayload | GeminiNativePayload {
    if (token.startsWith("ya29.")) {
        return { model: modelName, request: { contents } };
    }
    return { contents };
}

export function buildGeminiUrl(baseUrl: string, modelName: string, token: string): string {
    const cleanBaseUrl = baseUrl.replace(/\/openai$/, "");
    let url = `${cleanBaseUrl}/models/${modelName}:generateContent`;
    if (token.startsWith("AIzaSy")) {
        url += `?key=${token}`;
    }
    return url;
}

export interface GeminiRawResponse {
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
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        candidates_tokens_count?: number;
        totalTokenCount?: number;
        cachedContentTokenCount?: number;
    };
}

export function parseGeminiResponse(data: GeminiRawResponse): string {
    return (
        data.candidates?.[0]?.content?.parts?.[0]?.text ??
        data.responses?.[0]?.candidates?.[0]?.content?.parts?.[0]?.text ??
        data.response?.candidates?.[0]?.content?.parts?.[0]?.text ??
        ""
    );
}

export function geminiToOpenAIResponse(
    data: GeminiRawResponse,
    requestedModel: string
): ChatCompletionResponse {
    const textResponse = parseGeminiResponse(data);
    const usageMeta = data.usageMetadata;
    let usage: ChatCompletionResponse["usage"] = undefined;

    if (usageMeta) {
        const promptTokens = Number(usageMeta.promptTokenCount ?? 0);
        const completionTokens = Number(
            usageMeta.candidatesTokenCount ?? usageMeta.candidates_tokens_count ?? 0
        );
        const cachedTokens = Number(usageMeta.cachedContentTokenCount ?? 0);
        const total = promptTokens + completionTokens;

        usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: total,
            ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
        };
    }

    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: requestedModel,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: textResponse
                },
                finish_reason: "stop"
            }
        ],
        ...(usage ? { usage } : {})
    };
}

/**
 * ============================================================================
 * Antigravity IDE Envelope & Content Helpers
 *
 * Inspired by & ported from OmniRoute (open-sse/services/antigravity*.ts)
 * Upstream Reference: https://github.com/diegosouzapw/OmniRoute
 * ============================================================================
 */

// Official Antigravity IDE Desktop 2.1.1 fingerprint (macOS arm64)
export const ANTIGRAVITY_IDE_VERSION = "2.1.1";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

export const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 64000;

export function generateProjectId(): string {
    const adjectives = ["useful", "bright", "swift", "calm", "bold"];
    const nouns = ["fuze", "wave", "spark", "flow", "core"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

export function generateSessionId(): string {
    return crypto.randomUUID() + Date.now().toString();
}

function uuidFromSeed(seed: string): string {
    const bytes = crypto
        .createHash("sha256")
        .update(String(seed || "antigravity"))
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ANTIGRAVITY_IDE_REQUEST_ID_RE = /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/;

export interface IdeRequestIdArgs {
    body?: { requestId?: string };
    request?: { sessionId?: string; contents?: unknown[] };
    sessionId?: string;
    model: string;
    requestType: string;
}

/**
 * Build an IDE-format requestId: agent/<conversation>/<timestamp>/<trajectory>/<step>.
 * Antigravity backend validates this format — requests without it may be rejected.
 */
export function buildIdeRequestId({
    body,
    request,
    sessionId,
    model,
    requestType
}: IdeRequestIdArgs): string {
    if (body?.requestId && ANTIGRAVITY_IDE_REQUEST_ID_RE.test(body.requestId)) {
        return body.requestId;
    }
    const sid = request?.sessionId || sessionId || "anonymous";
    const conversationId = uuidFromSeed(`antigravity:conversation:${sid}`);
    const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sid}:${model}:${requestType}`);
    const contentCount = Array.isArray(request?.contents) ? request.contents.length : 1;
    const step = Math.max(1, contentCount * 2 - 1);
    return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

/**
 * Build the Antigravity IDE envelope: { project, model, userAgent, requestType, requestId, request }.
 * The daily-cloudcode host expects this envelope, not a bare generateContent call.
 */
export function buildAntigravityEnvelope(args: {
    projectId: string;
    model: string;
    requestType: string;
    request: Record<string, unknown>;
    body?: { requestId?: string };
    sessionId?: string;
    enabledCreditTypes?: string[];
}): Record<string, unknown> {
    const { projectId, model, requestType, request, body, sessionId, enabledCreditTypes } = args;
    const envelope: Record<string, unknown> = {
        project: projectId,
        model,
        userAgent: "antigravity",
        requestType,
        requestId: buildIdeRequestId({ body, request, sessionId, model, requestType }),
        request
    };
    if (enabledCreditTypes && enabledCreditTypes.length > 0) {
        envelope.enabledCreditTypes = enabledCreditTypes;
    }
    return envelope;
}

export function buildGeminiStreamUrl(baseUrl: string, modelName: string): string {
    return `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
}

// ─── Gemini JSON Schema cleanup for Antigravity (port of 9router formats/gemini.js) ───

const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
    "minLength",
    "maxLength",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "format",
    "multipleOf",
    "uniqueItems",
    "contains",
    "unevaluatedProperties",
    "unevaluatedItems",
    "contentSchema",
    "default",
    "examples",
    "$schema",
    "$defs",
    "definitions",
    "const",
    "$ref",
    "$comment",
    "deprecated",
    "readOnly",
    "writeOnly",
    "additionalProperties",
    "propertyNames",
    "patternProperties",
    "enumDescriptions",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "dependencies",
    "dependentSchemas",
    "dependentRequired",
    "title",
    "optional",
    "if",
    "then",
    "else",
    "contentMediaType",
    "contentEncoding",
    "cornerRadius",
    "fillColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "gap",
    "padding",
    "strokeColor",
    "strokeThickness",
    "textColor"
];

function removeUnsupportedKeywords(obj: unknown, keywords: string[]): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
        for (const item of obj) removeUnsupportedKeywords(item, keywords);
        return;
    }
    for (const key of Object.keys(obj as Record<string, unknown>)) {
        if (keywords.includes(key) || key.startsWith("x-")) {
            delete (obj as Record<string, unknown>)[key];
            continue;
        }
        const value = (obj as Record<string, unknown>)[key];
        if (value && typeof value === "object") removeUnsupportedKeywords(value, keywords);
    }
}

function convertConstToEnum(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.const !== undefined && !o.enum) {
        o.enum = [o.const];
        delete o.const;
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") convertConstToEnum(value);
    }
}

function convertEnumValuesToStrings(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.enum && Array.isArray(o.enum)) {
        o.enum = o.enum.map((v) => String(v));
        if (!o.type) o.type = "string";
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") convertEnumValuesToStrings(value);
    }
}

function mergeAllOf(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.allOf && Array.isArray(o.allOf)) {
        const merged: Record<string, unknown> = {};
        for (const item of o.allOf as Record<string, unknown>[]) {
            if (item.properties) {
                if (!merged.properties) merged.properties = {};
                Object.assign(merged.properties as Record<string, unknown>, item.properties);
            }
            if (item.required && Array.isArray(item.required)) {
                if (!merged.required) merged.required = [];
                for (const req of item.required as string[]) {
                    if (!(merged.required as string[]).includes(req))
                        (merged.required as string[]).push(req);
                }
            }
        }
        delete o.allOf;
        if (merged.properties)
            o.properties = {
                ...(o.properties as Record<string, unknown>),
                ...(merged.properties as Record<string, unknown>)
            };
        if (merged.required)
            o.required = [...((o.required as string[]) || []), ...(merged.required as string[])];
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") mergeAllOf(value);
    }
}

function selectBest(items: Array<Record<string, unknown>>): number {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let score = 0;
        const type = item.type;
        if (type === "object" || item.properties) score = 3;
        else if (type === "array" || item.items) score = 2;
        else if (type && type !== "null") score = 1;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function flattenAnyOfOneOf(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.anyOf && Array.isArray(o.anyOf) && o.anyOf.length > 0) {
        const nonNull = (o.anyOf as Array<Record<string, unknown>>).filter(
            (s) => s && s.type !== "null"
        );
        if (nonNull.length > 0) {
            const selected = nonNull[selectBest(nonNull)];
            delete o.anyOf;
            Object.assign(o, selected);
        }
    }
    if (o.oneOf && Array.isArray(o.oneOf) && o.oneOf.length > 0) {
        const nonNull = (o.oneOf as Array<Record<string, unknown>>).filter(
            (s) => s && s.type !== "null"
        );
        if (nonNull.length > 0) {
            const selected = nonNull[selectBest(nonNull)];
            delete o.oneOf;
            Object.assign(o, selected);
        }
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") flattenAnyOfOneOf(value);
    }
}

function flattenTypeArrays(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.type && Array.isArray(o.type)) {
        const nonNullTypes = (o.type as string[]).filter((t) => t !== "null");
        o.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") flattenTypeArrays(value);
    }
}

function ensureObjectType(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.properties && !o.type) o.type = "object";
    for (const v of Object.values(o)) if (v && typeof v === "object") ensureObjectType(v);
}

/**
 * Google's GenerateContentRequest rejects `type: "array"` schemas without `items`
 * ("properties[x].items: missing field"). Client tool schemas frequently omit it,
 * so synthesize one: reuse prefixItems/contains when present, else a string item.
 */
function ensureArrayItems(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
        for (const item of obj) ensureArrayItems(item);
        return;
    }
    const o = obj as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type.toLowerCase() : undefined;
    if (type === "array" && (!o.items || typeof o.items !== "object")) {
        const prefix = Array.isArray(o.prefixItems)
            ? (o.prefixItems as unknown[]).find((s) => s && typeof s === "object")
            : undefined;
        const fallback =
            prefix ?? (o.contains && typeof o.contains === "object" ? o.contains : undefined);
        o.items = fallback ? structuredClone(fallback) : { type: "string" };
    }
    delete o.prefixItems;
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") ensureArrayItems(value);
    }
}

function cleanupRequired(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o.required && Array.isArray(o.required) && o.properties) {
        const props = o.properties as Record<string, unknown>;
        const valid = (o.required as string[]).filter((f) =>
            Object.prototype.hasOwnProperty.call(props, f)
        );
        if (valid.length === 0) delete o.required;
        else o.required = valid;
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") cleanupRequired(value);
    }
}

function addPlaceholders(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (Object.keys(o).length === 0) {
        o.type = "object";
        o.properties = {
            reason: {
                type: "string",
                description: "Brief explanation of why you are calling this tool"
            }
        };
        o.required = ["reason"];
        return;
    }
    if (o.type === "object") {
        if (!o.properties || Object.keys(o.properties as Record<string, unknown>).length === 0) {
            o.properties = {
                reason: {
                    type: "string",
                    description: "Brief explanation of why you are calling this tool"
                }
            };
            o.required = ["reason"];
        }
    }
    for (const value of Object.values(o)) {
        if (value && typeof value === "object") addPlaceholders(value);
    }
}

/**
 * Clean a JSON Schema for Antigravity API compatibility — removes unsupported
 * keywords recursively (port of 9router cleanJSONSchemaForAntigravity).
 */
export function cleanJSONSchemaForAntigravity(schema: unknown): unknown {
    if (!schema || typeof schema !== "object") return schema;
    const cleaned = schema as Record<string, unknown>;
    convertConstToEnum(cleaned);
    convertEnumValuesToStrings(cleaned);
    mergeAllOf(cleaned);
    flattenAnyOfOneOf(cleaned);
    flattenTypeArrays(cleaned);
    ensureObjectType(cleaned);
    ensureArrayItems(cleaned);
    removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);
    cleanupRequired(cleaned);
    addPlaceholders(cleaned);
    return cleaned;
}

/**
 * Sanitize a function name for Gemini: [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}.
 */
export function sanitizeFunctionName(name: string): string {
    if (!name) return "_unknown";
    let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
    if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
    return s.substring(0, 64);
}

// ─── Gemini SSE stream → OpenAI chunks (port of 9router response/gemini-to-openai.js) ───

export interface GeminiStreamState {
    messageId?: string;
    model: string;
    functionIndex: number;
    geminiToolCallCount: number;
    finishReason?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        prompt_tokens_details?: {
            cached_tokens?: number;
        };
    };
    toolNameMap?: Map<string, string> | null;
    remainingCredits?: Array<{ creditType: string; creditAmount: string }> | null;
}

export function createGeminiStreamState(
    model: string,
    toolNameMap?: Map<string, string> | null
): GeminiStreamState {
    return { model, functionIndex: 0, geminiToolCallCount: 0, toolNameMap };
}

function geminiChunkMeta(state: GeminiStreamState) {
    return {
        id: `chatcmpl-${state.messageId || Date.now()}`,
        created: Math.floor(Date.now() / 1000),
        model: state.model
    };
}

function buildGeminiChunk(
    state: GeminiStreamState,
    delta: Record<string, unknown>,
    finishReason: string | null
): ChatCompletionChunk {
    return {
        id: `chatcmpl-${state.messageId || Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: state.model,
        choices: [
            {
                index: 0,
                delta: delta as ChatCompletionChunk["choices"][0]["delta"],
                finish_reason: finishReason as ChatCompletionChunk["choices"][0]["finish_reason"]
            }
        ]
    };
}

function emitGeminiFunctionCall(
    functionCall: {
        name: string;
        args?: Record<string, unknown>;
        thoughtSignature?: string;
        thought_signature?: string;
    },
    state: GeminiStreamState,
    thoughtSignature?: string
): ChatCompletionChunk {
    const rawName = functionCall.name;
    const fcName = state.toolNameMap?.get(rawName) || rawName;
    const fcArgs = stripZeroWidth(functionCall.args || {});
    const toolCallIndex = state.functionIndex++;
    state.geminiToolCallCount++;
    const sig = thoughtSignature || functionCall.thoughtSignature || functionCall.thought_signature;
    return buildGeminiChunk(
        state,
        {
            tool_calls: [
                {
                    index: toolCallIndex,
                    id: `${fcName}-${Date.now()}-${toolCallIndex}`,
                    type: "function",
                    function: { name: fcName, arguments: JSON.stringify(fcArgs) },
                    ...(sig ? { thought_signature: sig, thoughtSignature: sig } : {})
                }
            ]
        },
        null
    );
}

/**
 * Convert a Gemini/Antigravity SSE chunk into OpenAI ChatCompletionChunk(s).
 * Returns null when the chunk produces no output.
 */
export function geminiStreamToOpenAIChunks(
    chunk: Record<string, unknown>,
    state: GeminiStreamState
): ChatCompletionChunk[] | null {
    if (!chunk) return null;

    const response = (chunk.response as Record<string, unknown>) || chunk;
    const candidates = response.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates?.[0]) return null;

    const results: ChatCompletionChunk[] = [];
    const candidate = candidates[0];
    const content = candidate.content as { parts?: GeminiContentPart[] } | undefined;

    if (!state.messageId) {
        state.messageId = (response.responseId as string) || `msg_${Date.now()}`;
        state.model = (response.modelVersion as string) || state.model;
        state.functionIndex = 0;
        state.geminiToolCallCount = 0;
        results.push(buildGeminiChunk(state, { role: "assistant" }, null));
    }

    if (content?.parts) {
        for (const part of content.parts) {
            const partAny = part as unknown as Record<string, unknown>;
            const fcAny = part.functionCall as Record<string, unknown> | undefined;
            const thoughtSig = (part.thoughtSignature ||
                partAny.thought_signature ||
                fcAny?.thoughtSignature ||
                fcAny?.thought_signature) as string | undefined;
            const hasThoughtSig = Boolean(thoughtSig);
            const isThought = part.thought === true;

            if (hasThoughtSig) {
                const hasTextContent = part.text !== undefined && part.text !== "";
                const hasFunctionCall = !!part.functionCall;
                if (hasTextContent) {
                    results.push(
                        buildGeminiChunk(
                            state,
                            isThought ? { reasoning_content: part.text } : { content: part.text },
                            null
                        )
                    );
                }
                if (hasFunctionCall && part.functionCall) {
                    results.push(emitGeminiFunctionCall(part.functionCall, state, thoughtSig));
                }
                continue;
            }

            if (part.text !== undefined && part.text !== "") {
                const textualToolCall = parseAntigravityTextualToolCall(part.text);
                if (textualToolCall) {
                    results.push(
                        emitGeminiFunctionCall(
                            {
                                name: textualToolCall.name,
                                args: textualToolCall.args as Record<string, unknown>
                            },
                            state
                        )
                    );
                } else {
                    results.push(
                        buildGeminiChunk(
                            state,
                            isThought ? { reasoning_content: part.text } : { content: part.text },
                            null
                        )
                    );
                }
            }

            if (part.functionCall) {
                results.push(emitGeminiFunctionCall(part.functionCall, state));
            }

            const inlineData =
                part.inlineData || (part as unknown as Record<string, unknown>).inline_data;
            if (inlineData && (inlineData as Record<string, unknown>).data) {
                const id = inlineData as Record<string, unknown>;
                const mimeType = id.mimeType || id.mime_type || "image/png";
                results.push(
                    buildGeminiChunk(
                        state,
                        {
                            images: [
                                {
                                    type: "image_url",
                                    image_url: { url: `data:${mimeType};base64,${id.data}` }
                                }
                            ]
                        },
                        null
                    )
                );
            }
        }
    }

    // Usage metadata
    const usageMeta =
        (response.usageMetadata as Record<string, unknown>) ||
        (chunk.usageMetadata as Record<string, unknown>);
    if (usageMeta) {
        const promptTokens = Number(usageMeta.promptTokenCount ?? 0);
        const completionTokens = Number(
            usageMeta.candidatesTokenCount ?? usageMeta.candidates_tokens_count ?? 0
        );
        const cachedTokens = Number(
            usageMeta.cachedContentTokenCount ?? usageMeta.totalCachedTokens ?? 0
        );
        const total = promptTokens + completionTokens;
        state.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: total,
            ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
        };
    }

    // Google One AI remaining credits extraction
    const rawCredits = chunk.remainingCredits || response.remainingCredits;
    if (Array.isArray(rawCredits)) {
        state.remainingCredits = rawCredits as Array<{ creditType: string; creditAmount: string }>;
    }

    // Finish reason
    if (candidate.finishReason) {
        let finishReason =
            String(candidate.finishReason) === "STOP"
                ? "stop"
                : String(candidate.finishReason).toLowerCase();
        if (finishReason === "stop" && state.geminiToolCallCount > 0) finishReason = "tool_calls";
        const finalChunk = buildGeminiChunk(state, {}, finishReason);
        if (state.usage) finalChunk.usage = state.usage;
        results.push(finalChunk);
        state.finishReason = finishReason;
    }

    return results.length > 0 ? results : null;
}

// ─── Antigravity request building (port of 9router / OmniRoute executors/antigravity) ───

// Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields)
const ANTIGRAVITY_REQUEST_BLACKLIST = [
    "output_config",
    "output_format",
    "thinking",
    "reasoning_effort",
    "reasoning",
    "enable_thinking",
    "thinking_budget",
    "thinkingConfig"
];

/**
 * Remove fields Google generateContent rejects from a request body.
 */
export function stripBlacklistedRequest(obj: Record<string, unknown>): void {
    for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
}

// Image generation model name patterns
const IMAGE_MODEL_PATTERNS = [/image/i, /imagen/i, /image-generation/i];

export function isImageModel(model: string): boolean {
    return IMAGE_MODEL_PATTERNS.some((p) => p.test(model));
}

// Parse aspect ratio / resolution from model name suffixes
export function parseImageConfig(model: string): Record<string, string> {
    const config: Record<string, string> = { aspectRatio: "1:1" };
    const resMatch = model.match(/(\d+)x(\d+)$/);
    if (resMatch) {
        const w = parseInt(resMatch[1]);
        const h = parseInt(resMatch[2]);
        if (w <= 16 && h <= 16) {
            config.aspectRatio = `${w}:${h}`;
        } else {
            const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
            const d = gcd(w, h);
            config.aspectRatio = `${w / d}:${h / d}`;
        }
    }
    return config;
}

// Strip zero-width Unicode characters
export function stripZeroWidth<T = unknown>(value: T): T {
    if (typeof value === "string") {
        return value.replace(/[\u200B-\u200D\uFEFF]/g, "") as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => stripZeroWidth(item)) as unknown as T;
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
                key,
                stripZeroWidth(item)
            ])
        ) as unknown as T;
    }
    return value;
}

// Competing-agent prompts that trigger Google Antigravity backend 429 RESOURCE_EXHAUSTED filter
export const COMPETITIVE_AGENT_PROMPT_PATTERNS: RegExp[] = [
    /\byou are a claude agent\b[^.\n]*\.?\s*/i,
    /\bbuilt on anthropic's claude agent sdk\b[^.\n]*\.?\s*/i,
    /\byou are claude code\b[^.\n]*\.?\s*/i,
    /\byou are an ai assistant created by anthropic\b[^.\n]*\.?\s*/i
];

export function stripCompetitiveAgentPrompts(text: string): string {
    if (!text || typeof text !== "string") return text;
    let res = text;
    for (const pattern of COMPETITIVE_AGENT_PROMPT_PATTERNS) {
        res = res
            .replace(pattern, "")
            .replace(/\n{3,}/g, "\n\n")
            .trimStart();
    }
    return res;
}

/**
 * Strip trailing assistant / model turn from contents.
 * Vertex AI & CloudCode reject requests ending on a model turn with 400.
 */
export function stripTrailingAssistantTurn(contents: GeminiContent[]): GeminiContent[] {
    while (contents.length > 1 && contents[contents.length - 1]?.role === "model") {
        contents.pop();
    }
    return contents;
}

/**
 * Resolve maximum output tokens cap per model family to avoid upstream 400 on oversized max_tokens.
 */
export function resolveAntigravityOutputCap(modelId?: string): number {
    if (!modelId) return 8192;
    const lower = modelId.toLowerCase();
    if (lower.includes("thinking") || lower.includes("opus") || lower.includes("sonnet")) {
        return 64000;
    }
    if (lower.includes("pro") || lower.includes("flash")) {
        return 65536;
    }
    return 8192;
}

/**
 * Pro family fallback chains when an upstream model ID returns 400 Bad Request.
 */
export const ANTIGRAVITY_PRO_FALLBACK_CHAINS: Record<string, string[]> = {
    "gemini-3.1-pro-high": ["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"],
    "gemini-3.1-pro-low": ["gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3-pro"],
    "gemini-pro-agent": ["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"]
};

export function getAntigravityModelFallbacks(modelName: string): string[] {
    const clean = parseAntigravityModelName(modelName);
    const raw = modelName.includes("/") ? (modelName.split("/")[1] ?? modelName) : modelName;
    return (
        ANTIGRAVITY_PRO_FALLBACK_CHAINS[clean] || ANTIGRAVITY_PRO_FALLBACK_CHAINS[raw] || [clean]
    );
}

/**
 * Parse textual markdown tool calls: `[Tool call: ...] \nArguments: ...`
 */
export function parseAntigravityTextualToolCall(
    text: unknown
): { name: string; args: unknown } | null {
    if (typeof text !== "string") return null;
    const normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const match = normalized.match(
        /^[\s\S]*?\[Tool call:\s*([^\]\n]+)\]\s*\nArguments:\s*([\s\S]+?)\s*$/
    );
    if (!match) return null;
    const name = match[1]?.trim();
    const rawArgs = match[2]?.trim();
    if (!name || !rawArgs) return null;
    try {
        return { name, args: stripZeroWidth(JSON.parse(rawArgs)) };
    } catch {
        return null;
    }
}

/**
 * Parse retry duration from 429 error messages (e.g. "quota will reset after 2h7m23s" or "Resets in 160h27m24s").
 */
export function parseRetryFromErrorMessage(errorMessage?: string): number | null {
    if (!errorMessage || typeof errorMessage !== "string") return null;
    const match = errorMessage.match(/resets? (?:after|in) (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000;
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000;
    if (match[3]) totalMs += parseInt(match[3]) * 1000;
    return totalMs === 0 ? 2000 : totalMs;
}

// Strip any {alias}/ or {providerId}/ prefix and map to Google CloudCode internal model names
export function parseAntigravityModelName(rawModel: string): string {
    const model = rawModel.includes("/") ? (rawModel.split("/")[1] ?? rawModel) : rawModel;
    if (model === "gemini-3.7-flash-high") {
        return "gemini-3.7-flash-tiered";
    }
    if (model === "gemini-3.7-flash-medium") {
        return "gemini-3.7-flash-tiered";
    }
    if (model === "gemini-3.7-flash-low") {
        return "gemini-3.7-flash-tiered";
    }
    if (model === "gemini-3.5-flash-high") {
        return "gemini-3-flash-agent";
    }
    if (model === "gemini-3.1-pro-high") {
        return "gemini-pro-agent";
    }
    if (model === "gemini-3.5-flash-medium") {
        return "gemini-3.5-flash-low";
    }
    if (model === "gemini-3.5-flash-low") {
        return "gemini-3.5-flash-extra-low";
    }
    return model;
}

/**
 * Build Antigravity Gemini contents from ChatCompletionRequest messages, mapping tools.
 */
export function buildAntigravityContents(req: ChatCompletionRequest): GeminiContent[] {
    const rawContents: GeminiContent[] = [];

    // Map tool_call_id to function name
    const toolCallNameMap = new Map<string, string>();
    for (const msg of req.messages) {
        if (Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                if (tc.id && tc.function?.name) {
                    toolCallNameMap.set(tc.id, tc.function.name);
                }
            }
        }
    }

    for (const m of req.messages) {
        const role = m.role === "assistant" ? "model" : "user";
        const parts: GeminiContentPart[] = [];

        if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
            let text = typeof m.content === "string" ? m.content.trim() : "";
            if (text) {
                text = stripCompetitiveAgentPrompts(stripZeroWidth(text));
                if (text) parts.push({ text });
            }

            for (const tc of m.tool_calls) {
                let args: Record<string, unknown> = {};
                try {
                    args = stripZeroWidth(JSON.parse(tc.function.arguments || "{}"));
                } catch {
                    args = { raw: tc.function.arguments };
                }
                const name = sanitizeFunctionName(tc.function.name);
                const rawTc = tc as unknown as Record<string, unknown>;
                const rawMsg = m as unknown as Record<string, unknown>;
                const thoughtSignature =
                    (rawTc.thoughtSignature as string) ||
                    (rawTc.thought_signature as string) ||
                    (rawMsg.thoughtSignature as string) ||
                    (rawMsg.thought_signature as string) ||
                    "skip_thought_signature_validator";

                parts.push({
                    functionCall: { name, args },
                    thoughtSignature
                });
            }
        } else if (
            m.role === "assistant" &&
            (m as unknown as Record<string, unknown>).function_call &&
            (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)
        ) {
            const rawM = m as unknown as Record<string, unknown>;
            const legacyFunctionCall = rawM.function_call as {
                name?: string;
                arguments?: string;
                thoughtSignature?: string;
                thought_signature?: string;
            };
            let text = typeof m.content === "string" ? m.content.trim() : "";
            if (text) {
                text = stripCompetitiveAgentPrompts(stripZeroWidth(text));
                if (text) parts.push({ text });
            }
            let args: Record<string, unknown> = {};
            try {
                args = stripZeroWidth(JSON.parse(legacyFunctionCall.arguments || "{}"));
            } catch {
                args = { raw: legacyFunctionCall.arguments };
            }
            const name = sanitizeFunctionName(legacyFunctionCall.name || "");
            const thoughtSignature =
                legacyFunctionCall.thoughtSignature ||
                legacyFunctionCall.thought_signature ||
                (rawM.thoughtSignature as string) ||
                (rawM.thought_signature as string) ||
                "skip_thought_signature_validator";

            parts.push({
                functionCall: { name, args },
                thoughtSignature
            });
        } else if (m.role === "tool") {
            const rawName =
                (m.tool_call_id ? toolCallNameMap.get(m.tool_call_id) : undefined) ||
                m.name ||
                m.tool_call_id ||
                "function";
            const name = sanitizeFunctionName(rawName);

            let responseObj: Record<string, unknown>;
            try {
                const parsed =
                    typeof m.content === "string"
                        ? JSON.parse(m.content)
                        : (m.content as unknown as Record<string, unknown>);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    responseObj = stripZeroWidth(parsed) as Record<string, unknown>;
                } else {
                    responseObj = { output: parsed ?? "" };
                }
            } catch {
                responseObj = { output: typeof m.content === "string" ? m.content : "" };
            }

            parts.push({
                functionResponse: {
                    name,
                    response: responseObj
                }
            });
        } else {
            let text =
                typeof m.content === "string"
                    ? m.content
                    : Array.isArray(m.content)
                      ? m.content.map((c) => (c.type === "text" ? c.text || "" : "")).join("\n")
                      : String(m.content ?? "");
            text = stripCompetitiveAgentPrompts(stripZeroWidth(text));
            if (text) parts.push({ text });
        }

        if (parts.length === 0) parts.push({ text: "..." });
        rawContents.push({ role, parts });
    }

    // Merge adjacent contents of the same role
    const contents: GeminiContent[] = [];
    for (const c of rawContents) {
        if (!Array.isArray(c.parts) || c.parts.length === 0) continue;
        if (contents.length > 0 && contents[contents.length - 1]?.role === c.role) {
            contents[contents.length - 1]?.parts.push(...c.parts);
        } else {
            contents.push(c);
        }
    }

    if (contents.length === 0) {
        contents.push({ role: "user", parts: [{ text: "..." }] });
    }

    // Strip trailing assistant / model turn
    return stripTrailingAssistantTurn(contents);
}

/**
 * Build Antigravity Gemini tools array from ChatCompletionRequest tools, sanitizing names + schemas.
 */
export function buildAntigravityTools(req: ChatCompletionRequest): Array<Record<string, unknown>> {
    if (!Array.isArray(req.tools) || req.tools.length === 0) return [];
    const declarations: Array<Record<string, unknown>> = [];
    const seenNames = new Set<string>();
    for (const tool of req.tools) {
        if (!tool || typeof tool !== "object") continue;
        const type = (tool as { type?: string }).type;
        if (type !== "function") continue;
        const fn = (
            tool as { function?: { name?: string; description?: string; parameters?: unknown } }
        ).function;
        if (!fn) continue;
        const name = sanitizeFunctionName(fn.name || "");
        if (seenNames.has(name)) continue;
        seenNames.add(name);
        declarations.push({
            name,
            description: fn.description || "",
            parameters: fn.parameters
                ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters))
                : {
                      type: "object",
                      properties: {
                          reason: { type: "string", description: "Brief explanation" }
                      },
                      required: ["reason"]
                  }
        });
    }
    return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
}
