import { z } from "zod";

export const UpdateSettingsSchema = z.object({
    require_api_key: z.boolean().optional(),
    settings: z.record(z.string()).optional()
});

export type UpdateSettingsZod = z.infer<typeof UpdateSettingsSchema>;

export const TokenSaverPreviewRequestSchema = z.object({
    type: z.enum(["tool_output", "prompt"]).optional().default("tool_output"),
    text: z
        .string({ required_error: "Field 'text' is required and must be a string" })
        .min(1, "Field 'text' cannot be empty"),
    settings: z.record(z.unknown()).optional()
});

export type TokenSaverPreviewRequestZod = z.infer<typeof TokenSaverPreviewRequestSchema>;
