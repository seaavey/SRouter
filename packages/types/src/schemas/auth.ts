import { z } from "zod";
import type { ProviderConfig } from "../provider.js";

export const AuthPollStatus = {
    PENDING: "pending",
    OK: "ok"
} as const;

export type AuthPollStatus = (typeof AuthPollStatus)[keyof typeof AuthPollStatus];

export const StatePayloadSchema = z.object({
    state: z.string().min(1)
});

export type StatePayload = z.infer<typeof StatePayloadSchema>;

export const OAuthCallbackBodySchema = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    callback_url: z.string().url().optional()
});

export type OAuthCallbackBody = z.infer<typeof OAuthCallbackBodySchema>;

export const TokenImportBodySchema = z
    .object({
        access_token: z
            .string({ required_error: "Field 'access_token' is required" })
            .min(1, "Field 'access_token' is required"),
        refresh_token: z.string().optional(),
        base_url: z.string().url().optional(),
        name: z.string().optional()
    })
    .passthrough();

export type TokenImportBody = z.infer<typeof TokenImportBodySchema>;

export interface AuthPollResult {
    status: AuthPollStatus;
    provider?: ProviderConfig;
    error?: string;
}
