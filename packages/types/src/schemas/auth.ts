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

export const TokenImportBodySchema = z.object({
    accessToken: z.string({ required_error: "Field 'accessToken' is required" }).min(1, "Field 'accessToken' is required"),
    refreshToken: z.string().optional(),
    baseUrl: z.string().url().optional(),
    name: z.string().optional()
}).passthrough();

export type TokenImportBody = z.infer<typeof TokenImportBodySchema>;
