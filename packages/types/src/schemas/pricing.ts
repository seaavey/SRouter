import { z } from "zod";

export const ModelPricingCostSchema = z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    reasoning: z.number().optional(),
    input_audio: z.number().optional(),
    output_audio: z.number().optional()
});

export type ModelPricingCost = z.infer<typeof ModelPricingCostSchema>;

export const ModelPricingLimitSchema = z.object({
    context: z.number().optional(),
    output: z.number().optional()
});

export type ModelPricingLimit = z.infer<typeof ModelPricingLimitSchema>;

export const ModelPricingModalitiesSchema = z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional()
});

export type ModelPricingModalities = z.infer<typeof ModelPricingModalitiesSchema>;

export const ModelPricingItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    family: z.string().optional(),
    provider: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    open_weights: z.boolean().optional(),
    knowledge: z.string().optional(),
    release_date: z.string().optional(),
    last_updated: z.string().optional(),
    cost: ModelPricingCostSchema,
    limit: ModelPricingLimitSchema.optional(),
    modalities: ModelPricingModalitiesSchema.optional()
});

export type ModelPricingItem = z.infer<typeof ModelPricingItemSchema>;

export const PricingListResponseSchema = z.object({
    object: z.literal("list"),
    total: z.number(),
    updated_at: z.string().optional(),
    data: z.array(ModelPricingItemSchema)
});

export type PricingListResponse = z.infer<typeof PricingListResponseSchema>;
