import { z } from "zod";

export const CreateAPIKeySchema = z.object({
    name: z
        .string({
            required_error: "Field 'name' is required"
        })
        .min(1, "Field 'name' cannot be empty"),
    rateLimit: z.number().int().nonnegative().optional(),
    quotaLimit: z.number().int().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export type CreateAPIKeyZod = z.infer<typeof CreateAPIKeySchema>;
