import {
    ANTIGRAVITY_IDE_BASE_URL,
    ANTIGRAVITY_OAUTH_CLIENT_ID,
    ANTIGRAVITY_OAUTH_REDIRECT_URI,
    ANTHROPIC_BASE_URL,
    BAI_BASE_URL,
    BLUESMINDS_BASE_URL,
    CODEBUDDY_BASE_URL,
    CODEBUDDY_CN_BASE_URL,
    CODEBUDDY_CN_DOMAIN,
    CODEBUDDY_CN_USER_AGENT,
    CODEX_OAUTH_CLIENT_ID,
    CODEX_OAUTH_REDIRECT_URI,
    COMMANDCODE_BASE_URL,
    GOROUTER_BASE_URL,
    SEEKAI_BASE_URL,
    TABITOKEN_BASE_URL,
    TOKENROUTER_BASE_URL
} from "@srouter/constants";
import {
    AntigravityExecutor,
    AnthropicExecutor,
    BAIExecutor,
    BluesMindsExecutor,
    CodeBuddyExecutor,
    CodexExecutor,
    CommandCodeExecutor,
    GoRouterExecutor,
    QoderExecutor,
    SeekAIExecutor,
    TabiTokenExecutor,
    TokenRouterExecutor
} from "@srouter/executors";
import {
    AntigravityOAuth,
    ClaudeOAuth,
    CodeBuddyCNOAuth,
    CodeBuddyOAuth,
    OpenAICodexOAuth,
    QoderOAuth
} from "@srouter/providers";
import type { AuthProviderHandler } from "@srouter/types";

const openaiCodex: AuthProviderHandler = {
    providerId: "openai_codex",
    displayName: "OpenAI Codex",
    category: "oauth",
    protocol: "openai",
    idPrefix: "openai_codex",
    clientId: () => CODEX_OAUTH_CLIENT_ID,
    defaultRedirectUri: CODEX_OAUTH_REDIRECT_URI,
    oauthSuccessMessage: "Login OpenAI Codex Berhasil!",
    tokenImportMessage:
        "OpenAI Codex Access Token registered and saved directly to SQLite database!",
    oauthClass: OpenAICodexOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accountId: tokens.account_id,
        expiresIn: tokens.expires_in
    }),
    mapImportTokens: (params) => ({
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        accountId: params.account_id
    }),
    buildExecutor: ({ id, name, accessToken, refreshToken, accountId }) =>
        new CodexExecutor({ id, name, accessToken, refreshToken, accountId })
};

const antigravity: AuthProviderHandler = {
    providerId: "antigravity",
    displayName: "Antigravity",
    category: "oauth",
    protocol: "openai",
    idPrefix: "antigravity",
    clientId: () => ANTIGRAVITY_OAUTH_CLIENT_ID,
    defaultRedirectUri: ANTIGRAVITY_OAUTH_REDIRECT_URI,
    baseUrl: () => ANTIGRAVITY_IDE_BASE_URL,
    oauthSuccessMessage: "Login Antigravity OAuth Berhasil!",
    tokenImportMessage:
        "Antigravity Access Token registered and saved directly to SQLite database!",
    oauthClass: AntigravityOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in
    }),
    mapImportTokens: (params) => ({
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, accessToken, refreshToken }) =>
        new AntigravityExecutor({ id, name, baseUrl, accessToken, refreshToken })
};

const commandCode: AuthProviderHandler = {
    providerId: "commandcode",
    displayName: "Command Code",
    category: "api_key",
    protocol: "openai",
    idPrefix: "commandcode",
    baseUrl: () => COMMANDCODE_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "Command Code API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new CommandCodeExecutor({ id, name, baseUrl, apiKey })
};

const anthropic: AuthProviderHandler = {
    providerId: "anthropic",
    displayName: "Anthropic",
    category: "api_key",
    protocol: "anthropic",
    idPrefix: "anthropic",
    baseUrl: () => ANTHROPIC_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "Anthropic API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new AnthropicExecutor({ id, name, baseUrl, apiKey })
};

const claude: AuthProviderHandler = {
    providerId: "claude",
    displayName: "Claude Code",
    category: "oauth",
    protocol: "anthropic",
    idPrefix: "claude",
    clientId: () => process.env.CLAUDE_OAUTH_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    defaultRedirectUri: "http://localhost:1455/auth/claude/callback",
    oauthSuccessMessage: "Login Claude Code OAuth Berhasil!",
    tokenImportMessage: "Claude Code OAuth token registered and saved directly to SQLite database!",
    oauthClass: ClaudeOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        organizationId: tokens.organization_id,
        expiresIn: tokens.expires_in
    }),
    mapImportTokens: (params) => ({
        accessToken: params.access_token,
        refreshToken: params.refresh_token
    }),
    buildExecutor: ({ id, name, accessToken, refreshToken, organizationId }) =>
        new AnthropicExecutor({ id, name, accessToken, refreshToken, organizationId })
};

const qoder: AuthProviderHandler = {
    providerId: "qoder",
    displayName: "Qoder",
    category: "oauth",
    protocol: "openai",
    idPrefix: "qoder",
    oauthSuccessMessage: "Login Qoder Berhasil!",
    tokenImportMessage:
        "Qoder Access Token / PAT registered and saved directly to SQLite database!",
    oauthClass: QoderOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accountId: tokens.account_id,
        expiresIn: tokens.expires_in
    }),
    mapImportTokens: (params) => ({
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        accountId: params.account_id,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey, accessToken, refreshToken }) =>
        new QoderExecutor({ id, name, baseUrl, apiKey, accessToken, refreshToken })
};

const goRouter: AuthProviderHandler = {
    providerId: "gorouter",
    displayName: "GoRouter",
    category: "api_key",
    protocol: "openai",
    idPrefix: "gorouter",
    baseUrl: () => GOROUTER_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "GoRouter API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new GoRouterExecutor({ id, name, baseUrl: baseUrl || GOROUTER_BASE_URL, apiKey })
};

const bluesMinds: AuthProviderHandler = {
    providerId: "bluesminds",
    displayName: "BluesMinds",
    category: "api_key",
    protocol: "openai",
    idPrefix: "bluesminds",
    baseUrl: () => BLUESMINDS_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "BluesMinds API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new BluesMindsExecutor({ id, name, baseUrl: baseUrl || BLUESMINDS_BASE_URL, apiKey })
};

const seekAI: AuthProviderHandler = {
    providerId: "seekai",
    displayName: "SeekAI",
    category: "api_key",
    protocol: "openai",
    idPrefix: "seekai",
    baseUrl: () => SEEKAI_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "SeekAI API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new SeekAIExecutor({ id, name, baseUrl: baseUrl || SEEKAI_BASE_URL, apiKey })
};

const tabiToken: AuthProviderHandler = {
    providerId: "tabitoken",
    displayName: "TabiToken",
    category: "api_key",
    protocol: "openai",
    idPrefix: "tabitoken",
    baseUrl: () => TABITOKEN_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "TabiToken API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new TabiTokenExecutor({ id, name, baseUrl: baseUrl || TABITOKEN_BASE_URL, apiKey })
};

const tokenRouter: AuthProviderHandler = {
    providerId: "tokenrouter",
    displayName: "TokenRouter",
    category: "api_key",
    protocol: "openai",
    idPrefix: "tokenrouter",
    baseUrl: () => TOKENROUTER_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "TokenRouter API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new TokenRouterExecutor({ id, name, baseUrl: baseUrl || TOKENROUTER_BASE_URL, apiKey })
};

const codeBuddy: AuthProviderHandler = {
    providerId: "codebuddy",
    displayName: "CodeBuddy",
    category: "oauth",
    protocol: "openai",
    idPrefix: "codebuddy",
    baseUrl: () => CODEBUDDY_BASE_URL,
    oauthSuccessMessage: "Login CodeBuddy Berhasil!",
    tokenImportMessage: "CodeBuddy Access Token registered and saved directly to SQLite database!",
    oauthClass: CodeBuddyOAuth,
    mapOAuthTokens: (tokens) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in
    }),
    mapImportTokens: (params) => ({
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, accessToken, apiKey }) =>
        new CodeBuddyExecutor({
            id,
            name,
            baseUrl: baseUrl || CODEBUDDY_BASE_URL,
            accessToken: accessToken || apiKey
        })
};

const codeBuddyCN: AuthProviderHandler = {
    providerId: "codebuddy-cn",
    displayName: "CodeBuddy CN",
    category: "oauth",
    protocol: "openai",
    idPrefix: "codebuddy-cn",
    baseUrl: () => CODEBUDDY_CN_BASE_URL,
    oauthSuccessMessage: "Login CodeBuddy CN Berhasil!",
    tokenImportMessage:
        "CodeBuddy CN Access Token registered and saved directly to SQLite database!",
    oauthClass: CodeBuddyCNOAuth,
    mapOAuthTokens: codeBuddy.mapOAuthTokens,
    mapImportTokens: codeBuddy.mapImportTokens,
    buildExecutor: ({ id, name, baseUrl, accessToken, apiKey }) =>
        new CodeBuddyExecutor({
            id,
            name,
            baseUrl: baseUrl || CODEBUDDY_CN_BASE_URL,
            accessToken: accessToken || apiKey,
            modelPrefix: "codebuddy-cn",
            domain: CODEBUDDY_CN_DOMAIN,
            userAgent: CODEBUDDY_CN_USER_AGENT,
            flavor: "cli"
        })
};

const bai: AuthProviderHandler = {
    providerId: "bai",
    displayName: "B.AI",
    category: "api_key",
    protocol: "openai",
    idPrefix: "bai",
    baseUrl: () => BAI_BASE_URL,
    oauthSuccessMessage: "",
    tokenImportMessage: "B.AI API Key registered and saved directly to SQLite database!",
    mapImportTokens: (params) => ({
        apiKey: params.access_token,
        refreshToken: params.refresh_token,
        baseUrl: params.base_url
    }),
    buildExecutor: ({ id, name, baseUrl, apiKey }) =>
        new BAIExecutor({ id, name, baseUrl: baseUrl || BAI_BASE_URL, apiKey })
};

export const AuthHandlers = {
    OpenAI: openaiCodex,
    Antigravity: antigravity,
    CommandCode: commandCode,
    Anthropic: anthropic,
    Claude: claude,
    Qoder: qoder,
    GoRouter: goRouter,
    BluesMinds: bluesMinds,
    SeekAI: seekAI,
    TabiToken: tabiToken,
    TokenRouter: tokenRouter,
    CodeBuddy: codeBuddy,
    CodeBuddyCN: codeBuddyCN,
    BAI: bai
} as const;

export const authProviderHandlers: Record<string, AuthProviderHandler> = {
    openai_codex: AuthHandlers.OpenAI,
    antigravity: AuthHandlers.Antigravity,
    commandcode: AuthHandlers.CommandCode,
    anthropic: AuthHandlers.Anthropic,
    claude: AuthHandlers.Claude,
    qoder: AuthHandlers.Qoder,
    gorouter: AuthHandlers.GoRouter,
    bluesminds: AuthHandlers.BluesMinds,
    seekai: AuthHandlers.SeekAI,
    tabitoken: AuthHandlers.TabiToken,
    tokenrouter: AuthHandlers.TokenRouter,
    codebuddy: AuthHandlers.CodeBuddy,
    "codebuddy-cn": AuthHandlers.CodeBuddyCN,
    bai: AuthHandlers.BAI
};
