import type { AnthropicRole } from "./chat.js";
import type { ToolDefinition } from "./openai.js";

export interface AnthropicContentBlock {
    type: "text" | "image" | "tool_use" | "tool_result" | "thinking" | "redacted_thinking";
    text?: string;
    thinking?: string;
    signature?: string;
    data?: string;
    source?: {
        type: "base64";
        media_type: string;
        data: string;
    };
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string | AnthropicContentBlock[];
    is_error?: boolean;
    cache_control?: { type: "ephemeral" };
}

export interface AnthropicMessage {
    role: AnthropicRole;
    content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: {
        type?: "object" | string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
    };
    cache_control?: { type: "ephemeral" };
}

export interface AnthropicMessageRequest {
    model: string;
    messages: AnthropicMessage[];
    system?: string | AnthropicContentBlock[];
    max_tokens: number;
    metadata?: Record<string, unknown>;
    stop_sequences?: string[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    tools?: AnthropicTool[] | ToolDefinition[];
    tool_choice?: {
        type: "auto" | "any" | "tool";
        name?: string;
        disable_parallel_tool_use?: boolean;
    };
    thinking?: {
        type: "enabled" | "disabled";
        budget_tokens?: number;
    };
}

export interface AnthropicMessageResponse {
    id: string;
    type: "message";
    role: "assistant";
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
    stop_sequence?: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    };
}

export type AnthropicStreamEvent =
    | {
          type: "message_start";
          message: {
              id: string;
              type: "message";
              role: "assistant";
              model: string;
              content: [];
              stop_reason: null;
              stop_sequence: null;
              usage: {
                  input_tokens: number;
                  output_tokens: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
              };
          };
      }
    | {
          type: "content_block_start";
          index: number;
          content_block:
              | { type: "text"; text: string }
              | { type: "thinking"; thinking: string }
              | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
      }
    | {
          type: "content_block_delta";
          index: number;
          delta:
              | { type: "text_delta"; text: string }
              | { type: "thinking_delta"; thinking: string }
              | { type: "input_json_delta"; partial_json: string };
      }
    | {
          type: "content_block_stop";
          index: number;
      }
    | {
          type: "message_delta";
          delta: {
              stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
              stop_sequence: string | null;
          };
          usage: {
              output_tokens: number;
          };
      }
    | {
          type: "message_stop";
      }
    | {
          type: "ping";
      };
