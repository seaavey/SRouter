import { randomUUID } from "node:crypto";
import type {
    ChatCompletionChunk,
    ChatCompletionChunkChoice,
    ChatCompletionChunkDeltaToolCall,
    ChatCompletionResponse,
    ChatMessage,

    ChatMessageRole,
    FinishReason,
    ToolCall,
    UsageInfo,
} from "@srouter/types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface FreebuffMessageInput {
    role: string;
    content: JsonValue;
    [key: string]: JsonValue;
}

export interface FreebuffToolInput {
    type: string;
    function: JsonObject;
    [key: string]: JsonValue;
}

export interface FreebuffRequestInput {
    model: string;
    messages: readonly FreebuffMessageInput[];
    [key: string]: JsonValue | readonly FreebuffMessageInput[] | readonly FreebuffToolInput[];
}

export interface FreebuffUpstreamChatRequest {
    model: string;
    messages: FreebuffMessageInput[];
    [key: string]: JsonValue | FreebuffMessageInput[];
}

type FreebuffFinishReason = FinishReason | string;
interface FreebuffLogprobEntry {
    token: string;
    logprob: number;
    bytes?: number[];
    top_logprobs?: FreebuffLogprobEntry[];
}
interface FreebuffChoiceLogprobs {
    content?: FreebuffLogprobEntry[];
    refusal?: FreebuffLogprobEntry[];
}
interface FreebuffChunkChoice extends Omit<ChatCompletionChunkChoice, "finish_reason"> {
    finish_reason: FreebuffFinishReason;
    logprobs?: FreebuffChoiceLogprobs;
}
export type FreebuffSanitizedChunk = Omit<ChatCompletionChunk, "choices"> & {
    choices: FreebuffChunkChoice[];
    system_fingerprint?: string;
};
interface FreebuffCompletionChoice extends Omit<ChatCompletionResponse["choices"][number], "finish_reason"> {
    finish_reason: FinishReason;
    legacy_finish_reason?: string;
}
export type FreebuffCompletionResponse = Omit<ChatCompletionResponse, "choices"> & {
    choices: FreebuffCompletionChoice[];
};

type ToolCallState = { id: string; type: "function"; name: string; arguments: string };
export interface FreebuffAccumulator {
    id: string;
    created: number;
    upstreamModel: string;
    content: string[];
    reasoning: string[];
    finishReason: FreebuffFinishReason;
    usage: UsageInfo | undefined;
    systemFingerprint: string | undefined;
    toolCalls: Map<number, ToolCallState>;
}

const ALLOWED_FIELDS = new Set([
    "frequency_penalty", "logit_bias", "logprobs", "max_completion_tokens", "max_tokens", "metadata",
    "modalities", "parallel_tool_calls", "presence_penalty", "reasoning_effort", "response_format", "seed",
    "service_tier", "stop", "store", "stream_options", "temperature", "tool_choice", "tools", "top_logprobs", "top_p", "user",
]);
const MAX_SCHEMA_DEPTH = 12;

function isObject(value: JsonValue): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function clone(value: JsonValue): JsonValue {
    if (Array.isArray(value)) return value.map(clone);
    if (isObject(value)) { const output: JsonObject = {}; for (const [key, child] of Object.entries(value)) output[key] = clone(child); return output; }
    return value;
}
function definitions(node: JsonObject): JsonObject | undefined {
    const output: JsonObject = {};
    let found = false;
    for (const key of ["definitions", "$defs"]) { const value = node[key]; if (isObject(value)) { found = true; Object.assign(output, value); } }
    return found ? output : undefined;
}
function mergeDefinitions(parent: JsonObject | undefined, local: JsonObject | undefined): JsonObject | undefined {
    if (!parent) return local;
    if (!local) return parent;
    return { ...parent, ...local };
}
function nullSchema(node: JsonObject): boolean {
    if (node.type === "null" || node.const === null) return true;
    return Array.isArray(node.enum) && node.enum.length === 1 && node.enum[0] === null;
}
function resolveRef(node: JsonObject, defs: JsonObject | undefined): JsonValue | undefined {
    if (!defs || Object.keys(node).length !== 1 || typeof node.$ref !== "string") return undefined;
    const prefix = node.$ref.startsWith("#/definitions/") ? "#/definitions/" : "#/$defs/";
    if (!node.$ref.startsWith(prefix)) return undefined;
    const target = defs[node.$ref.slice(prefix.length)];
    return target === undefined ? undefined : clone(target);
}
function normalizeSchema(node: JsonObject, inherited: JsonObject | undefined, depth: number): JsonObject {
    if (depth <= 0) return node;
    const defs = mergeDefinitions(inherited, definitions(node));
    const resolved = resolveRef(node, defs);
    if (resolved !== undefined && isObject(resolved)) return normalizeSchema(resolved, defs, depth - 1);
    const output: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
        if (key !== "definitions" && key !== "$defs" && key !== "nullable") output[key] = normalizeSchemaValue(value, defs, depth - 1);
    }
    for (const key of ["anyOf", "oneOf"]) {
        const value = output[key];
        if (!Array.isArray(value)) continue;
        const filtered = value.filter((entry) => !isObject(entry) || !nullSchema(entry));
        if (filtered.length === 0) delete output[key];
        else if (filtered.length === 1 && isObject(filtered[0])) { delete output[key]; Object.assign(output, filtered[0]); }
        else output[key] = filtered;
    }
    if (Array.isArray(output.type)) {
        const type = output.type.find((entry): entry is string => typeof entry === "string" && entry.trim() !== "" && entry !== "null");
        if (type) output.type = type; else delete output.type;
    }
    if (Array.isArray(output.enum)) {
        const seen = new Set<string>();
        const values = output.enum.filter((entry) => { if (entry === null) return false; const key = JSON.stringify(entry); if (seen.has(key)) return false; seen.add(key); return true; });
        if (values.length) output.enum = values; else delete output.enum;
    }
    if (output.const === null) delete output.const;
    return output;
}
function normalizeSchemaValue(value: JsonValue, defs: JsonObject | undefined, depth: number): JsonValue {
    if (Array.isArray(value)) return value.map((entry) => normalizeSchemaValue(entry, defs, depth));
    return isObject(value) ? normalizeSchema(value, defs, depth) : value;
}
function isFreebuffToolInput(value: JsonValue): value is FreebuffToolInput {
    return isObject(value) && typeof value.type === "string" && isObject(value.function);
}
function normalizeTools(tools: readonly JsonValue[]): JsonValue[] {
    return tools.map((tool) => {
        if (!isFreebuffToolInput(tool)) return clone(tool);
        const copy: FreebuffToolInput = { ...tool, function: { ...tool.function } };
        const params = copy.function.parameters;
        if (isObject(params)) copy.function.parameters = normalizeSchema(params, definitions(params), MAX_SCHEMA_DEPTH);
        return copy;
    });
}

export function normalizeRequest(req: FreebuffRequestInput): FreebuffUpstreamChatRequest {
    const output: FreebuffUpstreamChatRequest = { model: req.model, messages: req.messages.map((message) => ({ ...message, role: message.role === "developer" ? "system" : message.role })) };
    for (const [key, value] of Object.entries(req)) {
        if (ALLOWED_FIELDS.has(key) && value !== null) output[key] = key === "tools" && Array.isArray(value) ? normalizeTools(value) : value as JsonValue;
    }
    return output;
}

function integer(value: JsonValue, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback; }
function createdSeconds(value: JsonValue): number {
    const created = integer(value, 0);
    return created > 0 ? created : Math.floor(Date.now() / 1000);
}
function fallbackChatId(): string { return `chatcmpl-${randomUUID()}`; }
function fallbackToolCallId(): string { return `call_${randomUUID()}`; }
function parseLine(line: string): JsonValue | null {
    const text = line.trim();
    if (!text || text.startsWith(":") || /^(event|id|retry):/.test(text)) return null;
    const payload = text.startsWith("data:") ? text.slice(5).trim() : text;
    if (!payload || payload === "[DONE]" || !payload.startsWith("{")) return null;
    try { const value: JsonValue = JSON.parse(payload) as JsonValue; return isObject(value) ? value : null; } catch { return null; }
}
function usage(value: JsonValue): UsageInfo | undefined {
    if (!isObject(value) || typeof value.prompt_tokens !== "number" || typeof value.completion_tokens !== "number" || typeof value.total_tokens !== "number") return undefined;
    const result: UsageInfo = { prompt_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens, total_tokens: value.total_tokens };
    if (isObject(value.prompt_tokens_details) && typeof value.prompt_tokens_details.cached_tokens === "number") {
        result.prompt_tokens_details = { cached_tokens: value.prompt_tokens_details.cached_tokens };
    }
    if (isObject(value.completion_tokens_details) && typeof value.completion_tokens_details.reasoning_tokens === "number") {
        result.completion_tokens_details = { reasoning_tokens: value.completion_tokens_details.reasoning_tokens };
    }
    return result;
}
function role(value: JsonValue): ChatMessageRole | undefined { return value === "system" || value === "user" || value === "assistant" || value === "tool" || value === "function" ? value : undefined; }
function finish(value: JsonValue): FreebuffFinishReason { return value === null ? null : typeof value === "string" ? value : null; }
function isSrouterFinishReason(value: FreebuffFinishReason): value is FinishReason {
    return value === null || value === "stop" || value === "length" || value === "tool_calls" || value === "content_filter";
}
function logprobEntries(value: JsonValue): FreebuffLogprobEntry[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const entries: FreebuffLogprobEntry[] = [];
    for (const item of value) {
        if (!isObject(item) || typeof item.token !== "string" || typeof item.logprob !== "number" || !Number.isFinite(item.logprob)) continue;
        const entry: FreebuffLogprobEntry = { token: item.token, logprob: item.logprob };
        if (Array.isArray(item.bytes)) {
            const bytes = item.bytes.filter((byte): byte is number => typeof byte === "number" && Number.isInteger(byte));
            if (bytes.length === item.bytes.length) entry.bytes = bytes;
        }
        const topLogprobs = logprobEntries(item.top_logprobs);
        if (topLogprobs) entry.top_logprobs = topLogprobs;
        entries.push(entry);
    }
    return entries;
}
function choiceLogprobs(value: JsonValue): FreebuffChoiceLogprobs | undefined {
    if (!isObject(value)) return undefined;
    const output: FreebuffChoiceLogprobs = {};
    const content = logprobEntries(value.content);
    const refusal = logprobEntries(value.refusal);
    if (content) output.content = content;
    if (refusal) output.refusal = refusal;
    return content || refusal ? output : undefined;
}
function toolCallFragments(value: JsonValue): ChatCompletionChunkDeltaToolCall[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const fragments: ChatCompletionChunkDeltaToolCall[] = [];
    for (const entry of value) {
        if (!isObject(entry) || typeof entry.index !== "number") continue;
        const fragment: ChatCompletionChunkDeltaToolCall = { index: Math.trunc(entry.index) };
        if (typeof entry.id === "string") fragment.id = entry.id;
        if (entry.type === "function") fragment.type = "function";
        if (isObject(entry.function)) {
            const functionFragment: { name?: string; arguments?: string } = {};
            if (typeof entry.function.name === "string") functionFragment.name = entry.function.name;
            if (typeof entry.function.arguments === "string") functionFragment.arguments = entry.function.arguments;
            if (functionFragment.name !== undefined || functionFragment.arguments !== undefined) fragment.function = functionFragment;
        }
        fragments.push(fragment);
    }
    return fragments;
}

export function sanitizeSseLine(line: string): FreebuffSanitizedChunk | null {
    const raw = parseLine(line); if (!raw || !isObject(raw)) return null;
    const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
    const choices: FreebuffChunkChoice[] = [];
    for (const value of rawChoices) {
        if (!isObject(value)) continue;
        const rawDelta = isObject(value.delta) ? value.delta : {};
        const toolCalls = toolCallFragments(rawDelta.tool_calls);
        const delta = { ...(typeof rawDelta.content === "string" ? { content: rawDelta.content } : {}), ...(typeof rawDelta.reasoning_content === "string" ? { reasoning_content: rawDelta.reasoning_content } : {}), ...(role(rawDelta.role) ? { role: role(rawDelta.role) } : {}), ...(toolCalls ? { tool_calls: toolCalls } : {}) };
        const choice: FreebuffChunkChoice = { index: integer(value.index, 0), delta, finish_reason: finish(value.finish_reason ?? null) };
        const parsedLogprobs = choiceLogprobs(value.logprobs);
        if (parsedLogprobs) choice.logprobs = parsedLogprobs;
        choices.push(choice);
    }
    const parsedUsage = usage(raw.usage);
    if (!choices.length && !parsedUsage) return null;
    return { id: typeof raw.id === "string" && raw.id ? raw.id : fallbackChatId(), object: "chat.completion.chunk", created: createdSeconds(raw.created), model: typeof raw.model === "string" ? raw.model : "", choices, ...(parsedUsage ? { usage: parsedUsage } : {}), ...(typeof raw.system_fingerprint === "string" ? { system_fingerprint: raw.system_fingerprint } : {}) };
}

export function createAccumulator(): FreebuffAccumulator { return { id: fallbackChatId(), created: Math.floor(Date.now() / 1000), upstreamModel: "", content: [], reasoning: [], finishReason: null, usage: undefined, systemFingerprint: undefined, toolCalls: new Map() }; }
export function accumulateChunk(accumulator: FreebuffAccumulator, chunk: FreebuffSanitizedChunk): void {
    accumulator.id = chunk.id || accumulator.id; if (chunk.created > 0) accumulator.created = chunk.created; accumulator.upstreamModel = chunk.model || accumulator.upstreamModel; if (chunk.usage) accumulator.usage = chunk.usage; if (chunk.system_fingerprint) accumulator.systemFingerprint = chunk.system_fingerprint;
    for (const choice of chunk.choices) { if (choice.finish_reason !== null) accumulator.finishReason = choice.finish_reason; if (choice.delta.content) accumulator.content.push(choice.delta.content); if (choice.delta.reasoning_content) accumulator.reasoning.push(choice.delta.reasoning_content); for (const fragment of choice.delta.tool_calls ?? []) { const current = accumulator.toolCalls.get(fragment.index) ?? { id: fallbackToolCallId(), type: "function" as const, name: "", arguments: "" }; if (fragment.id) current.id = fragment.id; if (fragment.function?.name) current.name = fragment.function.name; if (fragment.function?.arguments) current.arguments += fragment.function.arguments; accumulator.toolCalls.set(fragment.index, current); } }
}
export function finishAccumulator(accumulator: FreebuffAccumulator, model: string): FreebuffCompletionResponse {
    const message: ChatMessage & { reasoning_content?: string } = { role: "assistant", content: accumulator.content.join("") };
    const calls: ToolCall[] = [...accumulator.toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
    if (calls.length) message.tool_calls = calls;
    if (accumulator.reasoning.join("")) message.reasoning_content = accumulator.reasoning.join("");
    const upstreamFinishReason = accumulator.finishReason ?? "stop";
    const completionChoice: FreebuffCompletionChoice = {
        index: 0,
        message,
        // Keep the public SRouter field narrow; retain an upstream-only reason in the extension below.
        finish_reason: isSrouterFinishReason(upstreamFinishReason) ? upstreamFinishReason : null,
        ...(isSrouterFinishReason(upstreamFinishReason) ? {} : { legacy_finish_reason: upstreamFinishReason }),
    };
    return { id: accumulator.id, object: "chat.completion", created: accumulator.created, model, choices: [completionChoice], usage: accumulator.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(accumulator.systemFingerprint ? { system_fingerprint: accumulator.systemFingerprint } : {}) };
}
export function removeFreebuffModelPrefix(model: string): string { return model.startsWith("freebuff/") ? model.slice("freebuff/".length) : model; }
export function withFreebuffModelPrefix(model: string): string { return model.startsWith("freebuff/") ? model : `freebuff/${model}`; }
