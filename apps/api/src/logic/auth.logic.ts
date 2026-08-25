import {
    CODEBUDDY_BASE_URL,
    CODEBUDDY_CN_BASE_URL,
    CODEBUDDY_CN_DOMAIN,
    CODEBUDDY_CN_USER_AGENT
} from "@srouter/constants";
import {
    cleanupExpiredOAuthSessionsDB,
    deleteOAuthSessionDB,
    getOAuthSessionDB,
    saveOAuthSessionDB,
    upsertProviderDB
} from "@srouter/db";
import { CodeBuddyCNOAuth, CodeBuddyOAuth, generatePKCE, QoderOAuth } from "@srouter/providers";
import { CodeBuddyExecutor, QoderExecutor } from "@srouter/executors";
import type { ProviderConfig } from "@srouter/types";
import { registry } from "@/services/registry.js";
import type {
    AuthProviderHandler,
    OAuthLoginParams,
    OAuthLoginResult,
    TokenImportParams
} from "@srouter/types";
import { AuthHandlers } from "@/services/authHandlers.js";

export type { OAuthLoginParams, OAuthLoginResult, TokenImportParams } from "@srouter/types";

const PKCE_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function CleanupExpiredSessions(): void {
    cleanupExpiredOAuthSessionsDB(PKCE_SESSION_MAX_AGE_MS);
}

function ResolveClientId(handler: AuthProviderHandler, params: OAuthLoginParams): string {
    return params.clientId || handler.clientId?.() || "";
}

function ResolveRedirectUri(handler: AuthProviderHandler, params: OAuthLoginParams): string {
    return params.redirectUri || handler.defaultRedirectUri || "";
}

function BuildAccountIdentity(
    handler: AuthProviderHandler,
    now: number
): { accountId: string; accountName: string } {
    return {
        accountId: `${handler.idPrefix}_${now}`,
        accountName: `${handler.displayName} (Account #${now.toString().slice(-4)})`
    };
}

function InitiatePKCEFor(handler: AuthProviderHandler, params: OAuthLoginParams): OAuthLoginResult {
    CleanupExpiredSessions();
    const clientId = ResolveClientId(handler, params);
    const redirectUri = ResolveRedirectUri(handler, params);
    const prompt = params.prompt;

    const oAuthInstance = new handler.oauthClass!({ clientId, redirectUri, prompt });

    const pkce = generatePKCE();
    saveOAuthSessionDB({
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        clientId,
        redirectUri,
        createdAt: Date.now()
    });

    const authorizeUrl = oAuthInstance.getAuthorizationUrl!(pkce);

    return {
        authorizeUrl,
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri
    };
}

async function ProcessOAuthCallbackFor(
    handler: AuthProviderHandler,
    code: string,
    state: string
): Promise<ProviderConfig> {
    CleanupExpiredSessions();

    const session = getOAuthSessionDB(state);
    if (!session) {
        throw new Error("Invalid or expired OAuth state parameter");
    }

    deleteOAuthSessionDB(state);

    const oAuthInstance = new handler.oauthClass!({
        clientId: session.clientId,
        redirectUri: session.redirectUri
    });

    const rawTokens = await oAuthInstance.exchangeCodeForTokens!(code, session.codeVerifier || "");
    const tokens = handler.mapOAuthTokens?.(rawTokens) ?? {
        accessToken: rawTokens.accessToken,
        refreshToken: rawTokens.refreshToken,
        expiresIn: rawTokens.expiresIn
    };

    const timestamp = Date.now();
    const { accountId, accountName } = BuildAccountIdentity(handler, timestamp);

    const baseUrl = handler.baseUrl ? handler.baseUrl() : undefined;

    const providerConfig = upsertProviderDB({
        id: accountId,
        providerId: handler.providerId,
        name: accountName,
        category: handler.category,
        protocol: handler.protocol,
        baseUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accountId: tokens.accountId,
        organizationId: tokens.organizationId,
        tokenExpiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        lastRefreshedAt: Date.now(),
        enabled: true,
        createdAt: timestamp
    });

    const providerInstance = handler.buildExecutor({
        id: accountId,
        name: accountName,
        accountId: tokens.accountId,
        organizationId: tokens.organizationId,
        baseUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
    });
    registry.registerProvider(providerInstance);

    return providerConfig;
}

function ProcessTokenImportFor(
    handler: AuthProviderHandler,
    params: TokenImportParams
): ProviderConfig {
    const timestamp = Date.now();
    const accountId = params.id || `${handler.idPrefix}_${timestamp}`;
    const providerName =
        params.name || `${handler.displayName} (Account #${timestamp.toString().slice(-4)})`;
    const mapping = handler.mapImportTokens?.(params) ?? {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        accountId: params.accountId
    };
    const baseUrl = params.baseUrl || handler.baseUrl?.();

    const providerConfig = upsertProviderDB({
        id: accountId,
        providerId: handler.providerId,
        name: providerName,
        category: handler.category,
        protocol: handler.protocol,
        baseUrl: mapping.baseUrl ?? baseUrl,
        apiKey: mapping.apiKey,
        accessToken: mapping.accessToken,
        refreshToken: mapping.refreshToken,
        accountId: mapping.accountId,
        organizationId: mapping.organizationId,
        enabled: true,
        createdAt: timestamp
    });

    const providerInstance = handler.buildExecutor({
        id: accountId,
        name: providerName,
        accountId: mapping.accountId,
        organizationId: mapping.organizationId,
        baseUrl: mapping.baseUrl ?? baseUrl,
        apiKey: mapping.apiKey,
        accessToken: mapping.accessToken,
        refreshToken: mapping.refreshToken
    });
    registry.registerProvider(providerInstance);

    return providerConfig;
}

export async function InitiateCodeBuddyOAuth(): Promise<{ authorizeUrl: string; state: string }> {
    return InitiateCodeBuddyOAuthFor(new CodeBuddyOAuth());
}

export async function InitiateCodeBuddyCNOAuth(): Promise<{
    authorizeUrl: string;
    state: string;
}> {
    return InitiateCodeBuddyOAuthFor(new CodeBuddyCNOAuth());
}

async function InitiateCodeBuddyOAuthFor(
    codeBuddyOAuth: CodeBuddyOAuth
): Promise<{ authorizeUrl: string; state: string }> {
    CleanupExpiredSessions();
    const { state, authUrl } = await codeBuddyOAuth.requestAuthState();

    saveOAuthSessionDB({
        state,
        codeVerifier: "",
        clientId: "",
        redirectUri: "",
        createdAt: Date.now()
    });

    return {
        authorizeUrl: authUrl,
        state
    };
}

export async function PollCodeBuddyDeviceToken(state: string): Promise<{
    status: "pending" | "ok";
    provider?: ProviderConfig;
    error?: string;
}> {
    return PollCodeBuddyDeviceTokenFor(state, {
        oauth: new CodeBuddyOAuth(),
        providerId: "codebuddy",
        displayName: "CodeBuddy",
        baseUrl: CODEBUDDY_BASE_URL
    });
}

export async function PollCodeBuddyCNDeviceToken(state: string): Promise<{
    status: "pending" | "ok";
    provider?: ProviderConfig;
    error?: string;
}> {
    return PollCodeBuddyDeviceTokenFor(state, {
        oauth: new CodeBuddyCNOAuth(),
        providerId: "codebuddy-cn",
        displayName: "CodeBuddy CN",
        baseUrl: CODEBUDDY_CN_BASE_URL
    });
}

async function PollCodeBuddyDeviceTokenFor(
    state: string,
    options: {
        oauth: CodeBuddyOAuth;
        providerId: "codebuddy" | "codebuddy-cn";
        displayName: string;
        baseUrl: string;
    }
): Promise<{ status: "pending" | "ok"; provider?: ProviderConfig; error?: string }> {
    if (!state) {
        return { status: "pending", error: "Missing state parameter" };
    }

    const session = getOAuthSessionDB(state);
    if (!session) {
        return { status: "pending", error: "Session expired or not found" };
    }

    let poll: {
        status: "pending" | "ok";
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
        error?: string;
    };

    try {
        poll = await options.oauth.pollToken(state);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "pending", error: msg };
    }

    if (poll.status !== "ok" || !poll.accessToken) {
        return { status: "pending", error: poll.error };
    }

    deleteOAuthSessionDB(state);

    const timestamp = Date.now();
    const accountId = `${options.providerId}_${timestamp}`;
    const accountName = `${options.displayName} (Account #${timestamp.toString().slice(-4)})`;

    const providerConfig = upsertProviderDB({
        id: accountId,
        providerId: options.providerId,
        name: accountName,
        category: "oauth",
        protocol: "openai",
        baseUrl: options.baseUrl,
        accessToken: poll.accessToken,
        refreshToken: poll.refreshToken,
        tokenExpiresAt: poll.expiresIn ? timestamp + poll.expiresIn * 1000 : undefined,
        lastRefreshedAt: timestamp,
        enabled: true,
        createdAt: timestamp
    });

    const providerInstance = new CodeBuddyExecutor({
        id: accountId,
        name: accountName,
        baseUrl: options.baseUrl,
        accessToken: poll.accessToken,
        modelPrefix: options.providerId,
        ...(options.providerId === "codebuddy-cn"
            ? {
                  domain: CODEBUDDY_CN_DOMAIN,
                  userAgent: CODEBUDDY_CN_USER_AGENT,
                  flavor: "cli" as const
              }
            : {})
    });
    registry.registerProvider(providerInstance);

    return {
        status: "ok",
        provider: providerConfig
    };
}

export async function PollQoderDeviceToken(state: string): Promise<{
    status: "pending" | "ok";
    provider?: ProviderConfig;
    error?: string;
}> {
    if (!state) {
        return { status: "pending", error: "Missing state parameter" };
    }

    const session = getOAuthSessionDB(state);
    if (!session) {
        return { status: "pending", error: "Session expired or not found" };
    }

    const qoderOAuth = new QoderOAuth();
    let poll: {
        status: "pending" | "ok";
        accessToken?: string;
        refreshToken?: string;
        userId?: string;
        expiresIn?: number;
    };
    try {
        poll = await qoderOAuth.pollDeviceToken({
            nonce: state,
            codeVerifier: session.codeVerifier
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "pending", error: msg };
    }

    if (poll.status !== "ok" || !poll.accessToken) {
        return { status: "pending" };
    }

    deleteOAuthSessionDB(state);

    const userInfo = await qoderOAuth.fetchUserInfo(poll.accessToken);
    const timestamp = Date.now();
    const accountId = `qoder_${timestamp}`;
    const accountName = userInfo.name
        ? `Qoder (${userInfo.name})`
        : `Qoder (Account #${timestamp.toString().slice(-4)})`;

    const providerConfig = upsertProviderDB({
        id: accountId,
        providerId: "qoder",
        name: accountName,
        category: "oauth",
        protocol: "openai",
        accessToken: poll.accessToken,
        refreshToken: poll.refreshToken,
        accountId: poll.userId || userInfo.id,
        tokenExpiresAt: poll.expiresIn ? timestamp + poll.expiresIn * 1000 : undefined,
        lastRefreshedAt: timestamp,
        providerSpecificData: {
            authMethod: "device",
            userId: poll.userId || userInfo.id || "",
            email: userInfo.email || "",
            name: userInfo.name || "",
            organizationId: userInfo.organizationId || ""
        },
        enabled: true,
        createdAt: timestamp
    });

    const providerInstance = new QoderExecutor({
        id: accountId,
        name: accountName,
        accessToken: poll.accessToken,
        refreshToken: poll.refreshToken,
        providerSpecificData: {
            authMethod: "device",
            userId: poll.userId || userInfo.id || "",
            email: userInfo.email || "",
            name: userInfo.name || "",
            organizationId: userInfo.organizationId || ""
        }
    });
    registry.registerProvider(providerInstance);

    return {
        status: "ok",
        provider: providerConfig
    };
}

interface AuthProviderEntry {
    initiate?: (params: OAuthLoginParams) => OAuthLoginResult;
    callback?: (code: string, state: string) => Promise<ProviderConfig>;
    importToken: (params: TokenImportParams) => ProviderConfig;
}

const authProviderEntries: Record<string, AuthProviderEntry> = {};

const RegisterEntry = (
    key: string,
    entry: Omit<AuthProviderEntry, "initiate" | "callback"> &
        Partial<Pick<AuthProviderEntry, "initiate" | "callback">>
): void => {
    authProviderEntries[key] = entry as AuthProviderEntry;
};

RegisterEntry("openai", {
    initiate: (params) => InitiatePKCEFor(AuthHandlers.OpenAI, params),
    callback: (code, state) => ProcessOAuthCallbackFor(AuthHandlers.OpenAI, code, state),
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.OpenAI, params)
});

RegisterEntry("antigravity", {
    initiate: (params) => InitiatePKCEFor(AuthHandlers.Antigravity, params),
    callback: (code, state) => ProcessOAuthCallbackFor(AuthHandlers.Antigravity, code, state),
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.Antigravity, params)
});

RegisterEntry("claude", {
    initiate: (params) => InitiatePKCEFor(AuthHandlers.Claude, params),
    callback: (code, state) => ProcessOAuthCallbackFor(AuthHandlers.Claude, code, state),
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.Claude, params)
});

RegisterEntry("qoder", {
    initiate: (params) => InitiatePKCEFor(AuthHandlers.Qoder, params),
    callback: (code, state) => ProcessOAuthCallbackFor(AuthHandlers.Qoder, code, state),
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.Qoder, params)
});

RegisterEntry("codebuddy", {
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.CodeBuddy, params)
});

RegisterEntry("codebuddy-cn", {
    importToken: (params) => ProcessTokenImportFor(AuthHandlers.CodeBuddyCN, params)
});

for (const [key, handler] of [
    ["commandcode", AuthHandlers.CommandCode],
    ["anthropic", AuthHandlers.Anthropic],
    ["gorouter", AuthHandlers.GoRouter],
    ["bluesminds", AuthHandlers.BluesMinds],
    ["seekai", AuthHandlers.SeekAI],
    ["tabitoken", AuthHandlers.TabiToken],
    ["tokenrouter", AuthHandlers.TokenRouter]
] as const) {
    RegisterEntry(key, {
        importToken: (params) => ProcessTokenImportFor(handler, params)
    });
}

export const AuthLogic = {
    initiateOAuthPKCE: (params: OAuthLoginParams): OAuthLoginResult =>
        authProviderEntries.openai.initiate!(params),
    processOAuthCallback: async (code: string, state: string): Promise<ProviderConfig> =>
        authProviderEntries.openai.callback!(code, state),
    processTokenImport: (params: TokenImportParams): ProviderConfig =>
        authProviderEntries.openai.importToken(params),

    initiateProviderOAuth(providerKey: string, params: OAuthLoginParams): OAuthLoginResult {
        const entry = authProviderEntries[providerKey];
        if (!entry?.initiate) throw new Error(`Unknown OAuth provider: ${providerKey}`);
        return entry.initiate(params);
    },

    processProviderOAuthCallback(
        providerKey: string,
        code: string,
        state: string
    ): Promise<ProviderConfig> {
        const entry = authProviderEntries[providerKey];
        if (!entry?.callback) throw new Error(`Unknown OAuth provider: ${providerKey}`);
        return entry.callback(code, state);
    },

    processProviderTokenImport(providerKey: string, params: TokenImportParams): ProviderConfig {
        const entry = authProviderEntries[providerKey];
        if (!entry) throw new Error(`Unknown auth provider: ${providerKey}`);
        return entry.importToken(params);
    },

    initiateCodeBuddyOAuth: InitiateCodeBuddyOAuth,
    initiateCodeBuddyCNOAuth: InitiateCodeBuddyCNOAuth,
    pollCodeBuddyDeviceToken: PollCodeBuddyDeviceToken,
    pollCodeBuddyCNDeviceToken: PollCodeBuddyCNDeviceToken,
    pollQoderDeviceToken: PollQoderDeviceToken,

    InitiateCodeBuddyOAuth,
    InitiateCodeBuddyCNOAuth,
    PollCodeBuddyDeviceToken,
    PollCodeBuddyCNDeviceToken,
    PollQoderDeviceToken,

    initiateAntigravityOAuthPKCE: (params: OAuthLoginParams) =>
        AuthLogic.initiateProviderOAuth("antigravity", params),
    processAntigravityOAuthCallback: (code: string, state: string) =>
        AuthLogic.processProviderOAuthCallback("antigravity", code, state),
    processAntigravityTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("antigravity", params),
    processCommandCodeTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("commandcode", params),
    processAnthropicTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("anthropic", params),
    initiateClaudeOAuthPKCE: (params: OAuthLoginParams) =>
        AuthLogic.initiateProviderOAuth("claude", params),
    processClaudeOAuthCallback: (code: string, state: string) =>
        AuthLogic.processProviderOAuthCallback("claude", code, state),
    processClaudeTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("claude", params),
    processGoRouterTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("gorouter", params),
    processBluesMindsTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("bluesminds", params),
    processSeekAITokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("seekai", params),
    processTabiTokenTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("tabitoken", params),
    processTokenRouterTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("tokenrouter", params),
    processCodeBuddyTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("codebuddy", params),
    initiateQoderOAuthPKCE: (params: OAuthLoginParams) =>
        AuthLogic.initiateProviderOAuth("qoder", params),
    processQoderOAuthCallback: (code: string, state: string) =>
        AuthLogic.processProviderOAuthCallback("qoder", code, state),
    processQoderTokenImport: (params: TokenImportParams) =>
        AuthLogic.processProviderTokenImport("qoder", params)
};
