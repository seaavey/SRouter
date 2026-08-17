import type { Context } from "hono";
import { getTokenSaverSettingsDB, setTokenSaverSettingsDB } from "@srouter/db";
import { previewTokenSaver } from "@srouter/translator";
import type { TokenSaverPreviewRequest } from "@srouter/types";
import { ok, err } from "@/utils/response.js";

export class TokenSaverController {
    public static getSettings(c: Context): Response {
        const settings = getTokenSaverSettingsDB();
        return ok(c, { settings });
    }

    public static async updateSettings(c: Context): Promise<Response> {
        try {
            const body = await c.req.json();
            const updated = setTokenSaverSettingsDB(body);
            return ok(c, {
                message: "Token Saver settings updated successfully",
                settings: updated
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return err(c, errorMessage, 400);
        }
    }

    public static async preview(c: Context): Promise<Response> {
        try {
            const body = await c.req.json<TokenSaverPreviewRequest>();
            if (!body.text || typeof body.text !== "string") {
                return err(c, "Field 'text' is required and must be a string", 400);
            }
            const type = body.type === "prompt" ? "prompt" : "tool_output";
            const settings = body.settings
                ? { ...getTokenSaverSettingsDB(), ...body.settings }
                : getTokenSaverSettingsDB();

            const preview = previewTokenSaver(type, body.text, settings);
            return ok(c, preview);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return err(c, errorMessage, 400);
        }
    }
}
