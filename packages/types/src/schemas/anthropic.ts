import { z } from "zod";
import type { AnthropicContentBlock } from "../anthropic.js";

const AnthropicCacheControlSchema = z.object({ type: z.literal("ephemeral") });

export const AnthropicContentBlockSchema: z.ZodType<AnthropicContentBlock> = z.object({
    type: z.enum(["text", "image", "tool_use", "tool_result", "thinking", "redacted_thinking"]),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    data: z.string().optional(),
    source: z
        .object({
            type: z.literal("base64"),
            media_type: z.string(),
            data: z.string()
        })
        .optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    tool_use_id: z.string().optional(),
    content: z.union([z.string(), z.lazy(() => z.array(AnthropicContentBlockSchema))]).optional(),
    is_error: z.boolean().optional(),
    cache_control: AnthropicCacheControlSchema.optional()
});

export const AnthropicMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([z.string(), z.array(AnthropicContentBlockSchema).max(200)])
});

export const AnthropicToolSchema = z.object({
    name: z.string().min(1).max(300),
    description: z.string().max(10_000).optional(),
    input_schema: z
        .object({
            type: z.string().optional(),
            properties: z.record(z.unknown()).optional(),
            required: z.array(z.string()).optional()
        })
        .passthrough(),
    cache_control: AnthropicCacheControlSchema.optional()
});

export const AnthropicMessageRequestSchema = z.object({
    model: z
        .string({ required_error: "Missing required field 'model'" })
        .min(1, "Missing required field 'model'")
        .max(300),
    messages: z
        .array(AnthropicMessageSchema, { required_error: "Missing required field 'messages'" })
        .min(1, "Parameter 'messages' cannot be empty")
        .max(1000, "Parameter 'messages' exceeds the maximum of 1000 entries"),
    system: z
        .union([z.string(), z.array(AnthropicContentBlockSchema).max(200)])
        .optional(),
    max_tokens: z
        .number()
        .int()
        .positive()
        .max(1_000_000, "Parameter 'max_tokens' exceeds the gateway maximum")
        .optional(),
    metadata: z.record(z.unknown()).optional(),
    stop_sequences: z.array(z.string().max(1000)).max(100).optional(),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    tools: z.array(AnthropicToolSchema).max(128).optional(),
    tool_choice: z
        .object({
            type: z.enum(["auto", "any", "tool"]),
            name: z.string().optional(),
            disable_parallel_tool_use: z.boolean().optional()
        })
        .optional(),
    thinking: z
        .object({
            type: z.enum(["enabled", "disabled"]),
            budget_tokens: z.number().int().positive().max(1_000_000).optional()
        })
        .optional()
});

export type AnthropicMessageRequestZod = z.infer<typeof AnthropicMessageRequestSchema>;
