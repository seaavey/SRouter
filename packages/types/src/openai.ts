import type { ChatRole } from "./chat.js";

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | null;

export type ToolChoiceOption =
    "none" | "auto" | "required" | { type: "function"; function: { name: string } };

export interface ChatMessageContentPart {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
        detail?: "auto" | "low" | "high";
    };
}

export interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

// Streaming tool_call delta (OpenAI chunk shape): partial fields, index required.
export interface ChatCompletionChunkDeltaToolCall {
    index: number;
    id?: string;
    type?: "function";
    function?: {
        name?: string;
        arguments?: string;
    };
}

export interface ToolFunctionParameterProperty {
    type: string;
    description?: string;
    enum?: string[];
}

export interface ToolFunctionParameters {
    type: "object";
    properties?: Record<string, ToolFunctionParameterProperty>;
    required?: string[];
}

export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: ToolFunctionParameters;
    };
}

export interface ChatMessage {
    role: ChatRole;
    content: string | ChatMessageContentPart[] | null;
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    n?: number;
    stream?: boolean;
    stop?: string | string[];
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    user?: string;
    tools?: ToolDefinition[];
    tool_choice?: ToolChoiceOption;
    response_format?: { type: string };
    reasoning_effort?: "none" | "low" | "medium" | "high" | (string & {});
    reasoning?: { effort?: string; summary?: string };
}

export interface UsageInfo {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
    completion_tokens_details?: {
        reasoning_tokens?: number;
    };
}

export interface ChatCompletionChoice {
    index: number;
    message: ChatMessage;
    finish_reason: FinishReason;
}

export interface ChatCompletionResponse {
    id: string;
    object: "chat.completion";
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage?: UsageInfo;
    system_fingerprint?: string;
}

export interface ChatCompletionChunkDelta {
    role?: ChatRole;
    content?: string;
    reasoning_content?: string;
    tool_calls?: ChatCompletionChunkDeltaToolCall[];
}

export interface ChatCompletionChunkChoice {
    index: number;
    delta: ChatCompletionChunkDelta;
    finish_reason: FinishReason;
}

export interface ChatCompletionChunk {
    id: string;
    object: "chat.completion.chunk";
    created: number;
    model: string;
    choices: ChatCompletionChunkChoice[];
    usage?: UsageInfo;
}

export interface ModelObject {
    id: string;
    object: "model";
    created?: number;
    owned_by: string;
}

export interface ModelListResponse {
    object: "list";
    data: ModelObject[];
}
