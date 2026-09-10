import { z } from "zod";

export const UpdateSettingsSchema = z.object({
    require_api_key: z.boolean().optional(),
    settings: z.record(z.string()).optional()
});

export type UpdateSettingsZod = z.infer<typeof UpdateSettingsSchema>;
