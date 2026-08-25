import type { Context } from "hono";
import { getTokenSaverSettingsDB, setTokenSaverSettingsDB } from "@srouter/db";
import { PreviewTokenSaver } from "@srouter/translator";
import {
    TokenSaverPreviewRequestSchema,
    TokenSaverSettingsSchema,
    type TokenSaverPreviewRequest,
    type TokenSaverSettings
} from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class TokenSaverController {
    public static GetSettings(c: Context): Response {
        return Ok(c, { settings: getTokenSaverSettingsDB() });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = TokenSaverSettingsSchema.partial().safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid settings payload", 400);
        }

        try {
            const Updated = setTokenSaverSettingsDB(Parsed.data as Partial<TokenSaverSettings>);
            return Ok(c, {
                message: "Token Saver settings updated successfully",
                settings: Updated
            });
        } catch (error) {
            return Err(
                c,
                error instanceof Error ? error.message : "Failed to update Token Saver settings",
                500
            );
        }
    }

    public static async Preview(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = TokenSaverPreviewRequestSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid preview payload", 400);
        }

        try {
            const CurrentSettings = getTokenSaverSettingsDB();
            const MergedSettings = Parsed.data.settings
                ? { ...CurrentSettings, ...Parsed.data.settings }
                : CurrentSettings;

            const PreviewResult = PreviewTokenSaver(
                Parsed.data.type,
                Parsed.data.text,
                MergedSettings as TokenSaverSettings
            );
            return Ok(c, PreviewResult);
        } catch (error) {
            return Err(
                c,
                error instanceof Error ? error.message : "Failed to generate preview",
                500
            );
        }
    }
}
