import { z } from "zod";

export const ProviderCategorySchema = z.enum(["oauth", "free_tier", "api_key", "custom_provider"]);
export const ProviderProtocolSchema = z.enum(["openai", "anthropic", "gemini", "custom"]);

export const CreateProviderSchema = z.object({
    id: z.string().optional(),
    provider_id: z.string().optional(),
    name: z
        .string({ required_error: "Field 'name' is required" })
        .min(1, "Field 'name' is required"),
    category: ProviderCategorySchema,
    protocol: ProviderProtocolSchema,
    base_url: z.string().url().optional(),
    api_key: z.string().optional(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    provider_specific_data: z.record(z.string()).optional(),
    custom_headers: z.record(z.string()).optional()
});

export type CreateProviderZod = z.infer<typeof CreateProviderSchema>;

export const VerifyProviderSchema = z.object({
    protocol: ProviderProtocolSchema.optional().default("openai"),
    base_url: z.string().url().optional(),
    api_key: z.string().optional()
});

export type VerifyProviderZod = z.infer<typeof VerifyProviderSchema>;

export const AddCustomModelSchema = z.object({
    model_id: z
        .string({ required_error: "Field 'model_id' is required" })
        .min(1, "Field 'model_id' cannot be empty")
});

export type AddCustomModelZod = z.infer<typeof AddCustomModelSchema>;
