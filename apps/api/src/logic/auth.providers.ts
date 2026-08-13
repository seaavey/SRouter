import {
    AntigravityExecutor,
    AnthropicExecutor,
    CodexExecutor,
    CommandCodeExecutor,
} from "@srouter/executors";
import { AntigravityOAuth, OpenAICodexOAuth } from "@srouter/providers";
import type {
    AIProvider,
    ProviderCategory,
    ProviderProtocol,
} from "@srouter/types";

export interface OAuthLoginParams {
    clientId?: string;
    redirectUri?: string;
    prompt?: string;
}

export interface OAuthLoginResult {
    authorizeUrl: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
}

export interface TokenImportParams {
    id?: string;
    accessToken: string;
    refreshToken?: string;
    accountId?: string;
    baseUrl?: string;
    name?: string;
}

/**
 * A raw OAuth token response as returned by a provider's `exchangeCodeForTokens`.
 * Kept structurally compatible with @srouter/providers' OAuthTokenResponse.
 */
export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    accountId?: string;
    expiresIn?: number;
}

/**
 * Builds a concrete executor from normalized token data.
 * Each provider's constructor differs (Codex needs accountId, api-key providers need apiKey + baseUrl), so
 * the factory lives per handler.
 */
export type ExecutorFactory = (args: {
    id: string;
    name: string;
    accountId?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
}) => AIProvider;

/**
 * An OAuth (PKCE) client class usable for login/callback/token-refresh.
 */
export interface OAuthClientClass {
    new (options?: { clientId?: string; redirectUri?: string; prompt?: string }): {
        getAuthorizationUrl(pkce: { codeChallenge: string; state: string }): string;
        exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokens>;
        refreshTokens(refreshToken: string): Promise<OAuthTokens>;
    };
}

/**
 * Normalizes a raw token import payload into the DB/executor field placements for a provider.
 * api-key providers place the token in `apiKey`; OAuth providers place it in `accessToken`.
 */
export interface ImportTokenMapping {
    accessToken?: string;
    refreshToken?: string;
    accountId?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface AuthProviderHandler {
    providerId: string;
    displayName: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    /** Prefix for generated account ids (`${idPrefix}_${Date.now()}`). */
    idPrefix: string;
    /** Resolve the OAuth client id at call time (env-first, matching today's behavior). */
    clientId?: () => string | undefined;
    defaultRedirectUri?: string;
    /** Resolve the base URL at call time (env-first). OAuth callback uses this for saved providers. */
    baseUrl?: () => string | undefined;
    /** Message returned on successful OAuth login (preserved verbatim). */
    oauthSuccessMessage: string;
    /** Message returned on successful token import (preserved verbatim). */
    tokenImportMessage: string;
    /** Maps raw OAuth tokens to the fields a provider stores/executes with. */
    mapOAuthTokens?: (tokens: OAuthTokens) => {
        accessToken: string;
        refreshToken?: string;
        accountId?: string;
        expiresIn?: number;
        baseUrl?: string;
    };
    /** Maps a token-import payload to DB/executor field placements. */
    mapImportTokens?: (params: TokenImportParams) => ImportTokenMapping;
    buildExecutor: ExecutorFactory;
    /** Present only for OAuth-backed providers. */
    oauthClass?: OAuthClientClass;
}

const CODEX_DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ANTIGRAVITY_DEFAULT_CLIENT_ID =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_DEFAULT_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const COMMANDCODE_DEFAULT_BASE_URL = "https://api.commandcode.ai/alpha/generate";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

export const openaiCodexAuthHandler: AuthProviderHandler = {
    providerId: "openai_codex",
    displayName: "OpenAI Codex",
    category: "oauth",
    protocol: "openai",
    idPrefix: "openai_codex",
    // Matches the original logic: Codex client id is hardcoded (the env var is only read by the OAuth class itself).
    clientId: () => CODEX_DEFAULT_CLIENT_ID,
    defaultRedirectUri: "http://localhost:1455/auth/callback",
    oauthSuccessMessage: "Login OpenAI Codex Berhasil!",
    tokenImportMessage: "OpenAI Codex Access Token registered and saved directly to SQLite database!",
    oauthClass: OpenAICodexOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accountId: tokens.accountId,
        expiresIn: tokens.expiresIn,
    }),
    mapImportTokens: (params) => ({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        accountId: params.accountId,
    }),
    buildExecutor: ({ id, name, accessToken, refreshToken, accountId }) =>
        new CodexExecutor({ id, name, accessToken, refreshToken, accountId }),
};

export const antigravityAuthHandler: AuthProviderHandler = {
    providerId: "antigravity",
    displayName: "Antigravity",
    category: "oauth",
    protocol: "openai",
    idPrefix: "antigravity",
    clientId: () => process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? ANTIGRAVITY_DEFAULT_CLIENT_ID,
    defaultRedirectUri: "http://localhost:1455/auth/antigravity/callback",
    baseUrl: () => process.env.ANTIGRAVITY_BASE_URL ?? ANTIGRAVITY_DEFAULT_BASE_URL,
    oauthSuccessMessage: "Login Antigravity OAuth Berhasil!",
    tokenImportMessage: "Antigravity Access Token registered and saved directly to SQLite database!",
    oauthClass: AntigravityOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
    }),
    mapImportTokens: (params) => ({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        baseUrl: params.baseUrl,
    }),
    buildExecutor: ({ id, name, baseUrl, accessToken, refreshToken }) =>
        new AntigravityExecutor({ id, name, baseUrl, accessToken, refreshToken }),
};

export const commandCodeAuthHandler: AuthProviderHandler = {
    providerId: "commandcode",
    displayName: "Command Code",
    category: "api_key",
    protocol: "openai",
    idPrefix: "commandcode",
    baseUrl: () => process.env.COMMANDCODE_BASE_URL ?? COMMANDCODE_DEFAULT_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "Command Code API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.accessToken,
        refreshToken: params.refreshToken,
        baseUrl: params.baseUrl,
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new CommandCodeExecutor({ id, name, baseUrl, apiKey }),
};

export const anthropicAuthHandler: AuthProviderHandler = {
    providerId: "anthropic",
    displayName: "Anthropic",
    category: "api_key",
    protocol: "anthropic",
    idPrefix: "anthropic",
    baseUrl: () => process.env.ANTHROPIC_BASE_URL ?? ANTHROPIC_DEFAULT_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "Anthropic API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.accessToken,
        refreshToken: params.refreshToken,
        baseUrl: params.baseUrl,
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new AnthropicExecutor({ id, name, baseUrl, apiKey }),
};

export const authProviderHandlers: Record<string, AuthProviderHandler> = {
    openai_codex: openaiCodexAuthHandler,
    antigravity: antigravityAuthHandler,
    commandcode: commandCodeAuthHandler,
    anthropic: anthropicAuthHandler,
};
