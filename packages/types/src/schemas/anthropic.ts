import { z } from "zod";

export const AnthropicMessageRequestSchema = z.object({
    model: z.string({ required_error: "Missing required field 'model'" }).min(1, "Missing required field 'model'"),
    messages: z.array(z.any(), { required_error: "Missing required field 'messages'" }),
    system: z.union([z.string(), z.array(z.any())]).optional(),
    max_tokens: z.number().int().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
    thinking: z
        .object({
            type: z.enum(["enabled", "disabled"]),
            budget_tokens: z.number().int().positive().optional()
        })
        .optional()
});

export type AnthropicMessageRequestZod = z.infer<typeof AnthropicMessageRequestSchema>;
