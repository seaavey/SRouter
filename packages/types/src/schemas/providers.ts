import { z } from "zod";

export const ProviderCategorySchema = z.enum(["custom", "oauth", "free_tier", "api_key"]);
export const ProviderProtocolSchema = z.enum(["openai", "anthropic", "gemini", "custom"]);

export const CreateProviderSchema = z.object({
    id: z.string().optional(),
    providerId: z.string().optional(),
    name: z
        .string({ required_error: "Field 'name' is required" })
        .min(1, "Field 'name' is required"),
    category: ProviderCategorySchema,
    protocol: ProviderProtocolSchema,
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    providerSpecificData: z.record(z.string()).optional(),
    customHeaders: z.record(z.string()).optional()
});

export type CreateProviderZod = z.infer<typeof CreateProviderSchema>;

export const VerifyProviderSchema = z.object({
    protocol: ProviderProtocolSchema.optional().default("openai"),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional()
});

export type VerifyProviderZod = z.infer<typeof VerifyProviderSchema>;

export const AddCustomModelSchema = z.object({
    modelId: z
        .string({ required_error: "Field 'modelId' is required" })
        .min(1, "Field 'modelId' cannot be empty")
});

export type AddCustomModelZod = z.infer<typeof AddCustomModelSchema>;
