import type { Context } from "hono";
import {
    getAllSettingsDB,
    getRequireApiKeyDB,
    setRequireApiKeyDB,
    setSettingDB
} from "@srouter/db";
import { Err, Ok } from "@/utils/response.js";

export class SettingsController {
    public static GetSettings(c: Context): Response {
        const requireApiKey = getRequireApiKeyDB();
        const all = getAllSettingsDB();
        return Ok(c, {
            requireApiKey,
            settings: all
        });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        try {
            const body = await c.req.json();
            if (typeof body.requireApiKey === "boolean") {
                setRequireApiKeyDB(body.requireApiKey);
            }
            if (body.settings && typeof body.settings === "object") {
                for (const [key, value] of Object.entries(body.settings)) {
                    if (typeof value === "string") {
                        setSettingDB(key, value);
                    }
                }
            }
            const requireApiKey = getRequireApiKeyDB();
            const all = getAllSettingsDB();
            return Ok(c, {
                message: "Settings updated successfully",
                requireApiKey,
                settings: all
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 400);
        }
    }


}
