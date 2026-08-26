export type ChatRole = "system" | "user" | "assistant" | "tool" | "function";
export type ChatMessageRole = ChatRole;

export type AnthropicRole = Extract<ChatRole, "user" | "assistant">;
export type AssistantOrUserRole = Extract<ChatRole, "user" | "assistant">;
export type CommandCodeRole = Extract<ChatRole, "user" | "assistant" | "tool">;
