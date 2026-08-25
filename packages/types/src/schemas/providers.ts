import { z } from "zod";

export const CreateProviderSchema = z.object({
    providerId: z.string({ required_error: "Field 'providerId' is required" }),
    name: z.string({ required_error: "Field 'name' is required" }),
    category: z.enum(["custom", "oauth", "free_tier", "api_key"]),
    protocol: z.enum(["openai", "anthropic", "gemini", "custom"]),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    accessToken: z.string().optional(),
    customHeaders: z.record(z.string()).optional()
});

export type CreateProviderZod = z.infer<typeof CreateProviderSchema>;

export const VerifyProviderSchema = z.object({
    protocol: z.enum(["openai", "anthropic", "gemini", "custom"]),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional()
});

export type VerifyProviderZod = z.infer<typeof VerifyProviderSchema>;

export const AddCustomModelSchema = z.object({
    modelId: z.string({ required_error: "Field 'modelId' is required" }).min(1, "Field 'modelId' cannot be empty")
});

export type AddCustomModelZod = z.infer<typeof AddCustomModelSchema>;
