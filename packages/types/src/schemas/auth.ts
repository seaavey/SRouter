import { z } from "zod";

export const StatePayloadSchema = z.object({
    state: z.string().min(1)
});

export type StatePayload = z.infer<typeof StatePayloadSchema>;

export const OAuthCallbackBodySchema = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    callbackUrl: z.string().url().optional()
});

export type OAuthCallbackBody = z.infer<typeof OAuthCallbackBodySchema>;
