import type { Context } from "hono";
import { getTokenSaverSettingsDB, setTokenSaverSettingsDB } from "@srouter/db";
import { previewTokenSaver } from "@srouter/translator";
import {
    TokenSaverSettingsSchema,
    type TokenSaverPreviewRequest,
    type TokenSaverSettings
} from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class TokenSaverController {
    public static GetSettings(c: Context): Response {
        const settings = getTokenSaverSettingsDB();
        return Ok(c, { settings });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        try {
            const rawBody = await c.req.json().catch(() => null);
            const parsed = TokenSaverSettingsSchema.partial().safeParse(rawBody);
            if (!parsed.success) {
                return Err(c, parsed.error.issues[0]?.message || "Invalid settings payload", 400);
            }

            const updated = setTokenSaverSettingsDB(parsed.data as Partial<TokenSaverSettings>);
            return Ok(c, {
                message: "Token Saver settings updated successfully",
                settings: updated
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 400);
        }
    }

    public static async Preview(c: Context): Promise<Response> {
        try {
            const body = await c.req.json<TokenSaverPreviewRequest>().catch(() => null);
            if (!body?.text || typeof body.text !== "string") {
                return Err(c, "Field 'text' is required and must be a string", 400);
            }
            const type = body.type === "prompt" ? "prompt" : "tool_output";
            const settings = body.settings
                ? { ...getTokenSaverSettingsDB(), ...body.settings }
                : getTokenSaverSettingsDB();

            const preview = previewTokenSaver(type, body.text, settings);
            return Ok(c, preview);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 400);
        }
    }


}
