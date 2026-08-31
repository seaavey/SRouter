import { z } from "zod";

import type { JSONValue } from "../chat.js";

export const ContentPartSchema = z.object({
    type: z.enum(["text", "image_url"]),
    text: z.string().optional(),
    image_url: z
        .object({
            url: z.string(),
            detail: z.enum(["auto", "low", "high"]).optional()
        })
        .optional()
});

export const ToolCallFunctionSchema = z.object({
    name: z.string(),
    arguments: z.string()
});

export const ToolCallSchema = z.object({
    id: z.string(),
    type: z.literal("function"),
    function: ToolCallFunctionSchema
});

export const ChatMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool", "function", "developer"], {
        required_error:
            "Role is required and must be 'system', 'user', 'assistant', 'tool', 'function', or 'developer'"
    }),
    content: z.union([z.string(), z.array(ContentPartSchema), z.null()], {
        required_error: "Content is required"
    }),
    name: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
    tool_call_id: z.string().optional()
});

export const JSONSchemaValue: z.ZodType<JSONValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(JSONSchemaValue),
        z.record(JSONSchemaValue)
    ])
);

export const ToolParameterPropertySchema = z.record(JSONSchemaValue);

export const ToolParametersSchema = z
    .object({
        type: z.literal("object"),
        properties: z.record(ToolParameterPropertySchema).optional(),
        required: z.array(z.string()).optional()
    })
    .passthrough();

export const ToolDefinitionSchema = z.object({
    type: z.literal("function"),
    function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: ToolParametersSchema.optional()
    })
});

export const ToolChoiceSchema = z.union([
    z.enum(["none", "auto", "required"]),
    z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() })
    })
]);

export const ChatCompletionRequestSchema = z.object({
    model: z
        .string({
            required_error: "Missing required parameter 'model'"
        })
        .min(1)
        .max(300),
    messages: z
        .array(ChatMessageSchema, {
            required_error: "Missing required parameter 'messages'"
        })
        .min(1, "Parameter 'messages' cannot be empty")
        .max(1000, "Parameter 'messages' exceeds the maximum of 1000 entries"),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    n: z.number().int().positive().max(8).optional(),
    stream: z.boolean().optional(),
    stop: z.union([z.string(), z.array(z.string().max(1000)).max(16)]).optional(),
    max_tokens: z
        .number()
        .int()
        .positive()
        .max(1_000_000, "Parameter 'max_tokens' exceeds the gateway maximum")
        .optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    user: z.string().max(300).optional(),
    tools: z.array(ToolDefinitionSchema).max(128).optional(),
    tool_choice: ToolChoiceSchema.optional(),
    response_format: z
        .object({
            type: z.string(),
            json_schema: JSONSchemaValue.optional(),
            name: z.string().optional(),
            strict: z.boolean().optional()
        })
        .passthrough()
        .optional()
});

export type ChatCompletionRequestZod = z.infer<typeof ChatCompletionRequestSchema>;
