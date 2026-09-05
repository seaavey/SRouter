import { z } from "zod";

export const APIKeySchema = z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    rate_limit: z.number(),
    quota_limit: z.number(),
    usage_tokens: z.number(),
    credit_limit: z.number(),
    usage_cost: z.number(),
    allowed_models: z.array(z.string()).nullable().optional(),
    created_at: z.number()
});

export type APIKeyZod = z.infer<typeof APIKeySchema>;

export const CreateAPIKeySchema = z.object({
    name: z
        .string({
            required_error: "Field 'name' is required"
        })
        .min(1, "Field 'name' cannot be empty"),
    enabled: z.boolean().optional(),
    rate_limit: z.number().int().nonnegative().optional(),
    quota_limit: z.number().int().nonnegative().optional(),
    credit_limit: z.number().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export type CreateAPIKeyZod = z.infer<typeof CreateAPIKeySchema>;

export const UpdateAPIKeySchema = CreateAPIKeySchema.partial();

export type UpdateAPIKeyZod = z.infer<typeof UpdateAPIKeySchema>;

export const AddCreditSchema = z.object({
    amount: z
        .number({
            required_error: "Field 'amount' is required"
        })
        .positive("Amount must be greater than 0")
});

export type AddCreditZod = z.infer<typeof AddCreditSchema>;
