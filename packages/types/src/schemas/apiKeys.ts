import { z } from "zod";

export const CreateAPIKeySchema = z.object({
    name: z
        .string({
            required_error: "Field 'name' is required"
        })
        .min(1, "Field 'name' cannot be empty"),
    rateLimit: z.number().int().nonnegative().optional(),
    quotaLimit: z.number().int().nonnegative().optional(),
    creditLimit: z.number().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export type CreateAPIKeyZod = z.infer<typeof CreateAPIKeySchema>;

export const UpdateAPIKeySchema = z.object({
    name: z.string().min(1, "Field 'name' cannot be empty").optional(),
    enabled: z.boolean().optional(),
    rateLimit: z.number().int().nonnegative().optional(),
    quotaLimit: z.number().int().nonnegative().optional(),
    creditLimit: z.number().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export type UpdateAPIKeyZod = z.infer<typeof UpdateAPIKeySchema>;

export const AddCreditSchema = z.object({
    amount: z
        .number({
            required_error: "Field 'amount' is required"
        })
        .positive("Amount must be greater than 0")
});

export type AddCreditZod = z.infer<typeof AddCreditSchema>;
