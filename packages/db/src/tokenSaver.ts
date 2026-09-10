import { DEFAULT_TOKEN_SAVER_SETTINGS, type TokenSaverSettings } from "@srouter/types";

export async function getTokenSaverSettingsDB(): Promise<TokenSaverSettings> {
    return DEFAULT_TOKEN_SAVER_SETTINGS;
}
