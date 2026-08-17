import type { TokenSaverSettings } from "@srouter/types";
import { getSettingDB, setSettingDB } from "./settings.js";

export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
    enabled: true,
    compressToolOutput: {
        enabled: true,
        compressGit: true,
        compressGrep: true,
        compressFileLists: true,
        compressLogs: true,
        stripAnsiAndWhitespace: true,
        minCharacterThreshold: 50
    },
    lazySeniorDev: {
        enabled: true,
        mode: "balanced"
    },
    compressLlmOutput: {
        enabled: true,
        mode: "terse",
        stripPleasantries: true
    }
};

const SETTINGS_KEY = "token_saver_config";

export function getTokenSaverSettingsDB(): TokenSaverSettings {
    const raw = getSettingDB(SETTINGS_KEY, "");
    if (!raw) {
        return { ...DEFAULT_TOKEN_SAVER_SETTINGS };
    }
    try {
        const parsed = JSON.parse(raw) as Partial<TokenSaverSettings>;
        return {
            enabled: parsed.enabled ?? DEFAULT_TOKEN_SAVER_SETTINGS.enabled,
            compressToolOutput: {
                ...DEFAULT_TOKEN_SAVER_SETTINGS.compressToolOutput,
                ...(parsed.compressToolOutput ?? {})
            },
            lazySeniorDev: {
                ...DEFAULT_TOKEN_SAVER_SETTINGS.lazySeniorDev,
                ...(parsed.lazySeniorDev ?? {})
            },
            compressLlmOutput: {
                ...DEFAULT_TOKEN_SAVER_SETTINGS.compressLlmOutput,
                ...(parsed.compressLlmOutput ?? {})
            }
        };
    } catch {
        return { ...DEFAULT_TOKEN_SAVER_SETTINGS };
    }
}

export function setTokenSaverSettingsDB(settings: Partial<TokenSaverSettings>): TokenSaverSettings {
    const current = getTokenSaverSettingsDB();
    const updated: TokenSaverSettings = {
        enabled: typeof settings.enabled === "boolean" ? settings.enabled : current.enabled,
        compressToolOutput: {
            ...current.compressToolOutput,
            ...(settings.compressToolOutput ?? {})
        },
        lazySeniorDev: {
            ...current.lazySeniorDev,
            ...(settings.lazySeniorDev ?? {})
        },
        compressLlmOutput: {
            ...current.compressLlmOutput,
            ...(settings.compressLlmOutput ?? {})
        }
    };
    setSettingDB(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
}
