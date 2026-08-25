import type { Context } from "hono";
import {
    getAllSettingsDB,
    getRequireApiKeyDB,
    setRequireApiKeyDB,
    setSettingDB
} from "@srouter/db";
import { UpdateSettingsSchema } from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class SettingsController {
    public static GetSettings(c: Context): Response {
        return Ok(c, {
            requireApiKey: getRequireApiKeyDB(),
            settings: getAllSettingsDB()
        });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = UpdateSettingsSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid settings payload", 400);
        }

        try {
            if (typeof Parsed.data.requireApiKey === "boolean") {
                setRequireApiKeyDB(Parsed.data.requireApiKey);
            }
            if (Parsed.data.settings) {
                for (const [key, value] of Object.entries(Parsed.data.settings)) {
                    if (typeof value === "string") {
                        setSettingDB(key, value);
                    }
                }
            }

            return Ok(c, {
                message: "Settings updated successfully",
                requireApiKey: getRequireApiKeyDB(),
                settings: getAllSettingsDB()
            });
        } catch (error) {
            return Err(
                c,
                error instanceof Error ? error.message : "Failed to update settings",
                500
            );
        }
    }
}
