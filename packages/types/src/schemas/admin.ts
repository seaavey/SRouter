import { z } from "zod";

export const AdminSetupSchema = z.object({
    password: z.string({ required_error: "Password is required" }).min(1, "Password is required"),
    confirmation: z
        .string({ required_error: "Password confirmation is required" })
        .min(1, "Password confirmation is required")
});

export type AdminSetupZod = z.infer<typeof AdminSetupSchema>;

export const AdminLoginSchema = z.object({
    password: z.string({ required_error: "Password is required" }).min(1, "Password is required")
});

export type AdminLoginZod = z.infer<typeof AdminLoginSchema>;

export const AdminChangePasswordSchema = z.object({
    current_password: z
        .string({ required_error: "Current password is required" })
        .min(1, "Current password is required"),
    new_password: z
        .string({ required_error: "New password is required" })
        .min(1, "New password is required"),
    confirmation: z
        .string({ required_error: "Password confirmation is required" })
        .min(1, "Password confirmation is required")
});

export type AdminChangePasswordZod = z.infer<typeof AdminChangePasswordSchema>;

export const TunnelConfigSchema = z.object({
    token: z.string().optional(),
    domain: z.string().optional()
});

export type TunnelConfigZod = z.infer<typeof TunnelConfigSchema>;
