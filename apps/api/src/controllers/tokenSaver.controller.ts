import type { Context } from "hono";
import { getTokenSaverSettingsDB, setTokenSaverSettingsDB } from "@srouter/db";
import { PreviewTokenSaver } from "@srouter/translator";
import {
    TokenSaverPreviewRequestPayloadSchema,
    TokenSaverSettingsRequestSchema,
    type TokenSaverSettingsRequest,
    type TokenSaverSettings
} from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class TokenSaverController {
    private static ToInternalSettings(
        settings: TokenSaverSettingsRequest
    ): Partial<TokenSaverSettings> {
        return {
            enabled: settings.enabled,
            ...(settings.compress_tool_output
                ? {
                      compressToolOutput: {
                          enabled: settings.compress_tool_output.enabled ?? false,
                          compressGit: settings.compress_tool_output.compress_git ?? false,
                          compressGrep: settings.compress_tool_output.compress_grep ?? false,
                          compressFileLists:
                              settings.compress_tool_output.compress_file_lists ?? false,
                          compressLogs: settings.compress_tool_output.compress_logs ?? false,
                          stripAnsiAndWhitespace:
                              settings.compress_tool_output.strip_ansi_and_whitespace ?? false,
                          minCharacterThreshold:
                              settings.compress_tool_output.min_character_threshold ?? 50
                      }
                  }
                : {}),
            ...(settings.lazy_senior_dev
                ? {
                      lazySeniorDev: {
                          enabled: settings.lazy_senior_dev.enabled ?? false,
                          mode: settings.lazy_senior_dev.mode ?? "balanced",
                          customInstructions: settings.lazy_senior_dev.custom_instructions
                      }
                  }
                : {}),
            ...(settings.compress_llm_output
                ? {
                      compressLlmOutput: {
                          enabled: settings.compress_llm_output.enabled ?? false,
                          mode: settings.compress_llm_output.mode ?? "terse",
                          stripPleasantries:
                              settings.compress_llm_output.strip_pleasantries ?? false,
                          customPrompt: settings.compress_llm_output.custom_prompt
                      }
                  }
                : {})
        };
    }

    public static async GetSettings(c: Context): Promise<Response> {
        return Ok(c, { settings: await getTokenSaverSettingsDB() });
    }

    public static async UpdateSettings(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = TokenSaverSettingsRequestSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid settings payload", 400);
        }

        try {
            const Updated = await setTokenSaverSettingsDB(
                TokenSaverController.ToInternalSettings(Parsed.data)
            );
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
        const Parsed = TokenSaverPreviewRequestPayloadSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid preview payload", 400);
        }

        try {
            const CurrentSettings = await getTokenSaverSettingsDB();
            const MergedSettings = Parsed.data.settings
                ? {
                      ...CurrentSettings,
                      ...TokenSaverController.ToInternalSettings(Parsed.data.settings)
                  }
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
