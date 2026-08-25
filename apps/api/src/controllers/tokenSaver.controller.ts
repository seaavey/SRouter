import type { Context } from "hono";
import { getTokenSaverSettingsDB, setTokenSaverSettingsDB } from "@srouter/db";
import { previewTokenSaver } from "@srouter/translator";
import type { TokenSaverPreviewRequest } from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class TokenSaverController {
    public static GetSettings(c: Context): Response {
        const settings = getTokenSaverSettingsDB();
        return Ok(c, { settings });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        try {
            const body = await c.req.json();
            const updated = setTokenSaverSettingsDB(body);
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
            const body = await c.req.json<TokenSaverPreviewRequest>();
            if (!body.text || typeof body.text !== "string") {
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

    public static getSettings = TokenSaverController.GetSettings;
    public static updateSettings = TokenSaverController.UpdateSettings;
    public static preview = TokenSaverController.Preview;
}
