import {
    cleanupExpiredOAuthSessionsDB,
    deleteOAuthSessionDB,
    getOAuthSessionDB,
    saveOAuthSessionDB,
    upsertProviderDB,
} from "@srouter/db";
import { generatePKCE } from "@srouter/providers";
import type { ProviderConfig } from "@srouter/types";
import { registry } from "@/services/registry.js";
import {
    anthropicAuthHandler,
    antigravityAuthHandler,
    commandCodeAuthHandler,
    openaiCodexAuthHandler,
    type AuthProviderHandler,
    type OAuthLoginParams,
    type OAuthLoginResult,
    type TokenImportParams,
} from "./auth.providers.js";

export type { OAuthLoginParams, OAuthLoginResult, TokenImportParams } from "./auth.providers.js";

const PKCE_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function cleanupExpiredSessions(): void {
    cleanupExpiredOAuthSessionsDB(PKCE_SESSION_MAX_AGE_MS);
}

/**
 * Resolve the PKCE client id for a handler, honoring per-call env + query overrides,
 * mirroring the original per-provider defaults exactly.
 */
function resolveClientId(handler: AuthProviderHandler, params: OAuthLoginParams): string {
    return params.clientId || handler.clientId?.() || "";
}

function resolveRedirectUri(handler: AuthProviderHandler, params: OAuthLoginParams): string {
    return params.redirectUri || handler.defaultRedirectUri || "";
}

/**
 * Generate a stable, unique account id + human-friendly name for a newly saved provider.
 */
function buildAccountIdentity(handler: AuthProviderHandler, now: number): { accountId: string; accountName: string } {
    return {
        accountId: `${handler.idPrefix}_${now}`,
        accountName: `${handler.displayName} (Account #${now.toString().slice(-4)})`,
    };
}

// --- Generic engine (parameterized by an AuthProviderHandler) ---

function initiatePKCEFor(handler: AuthProviderHandler, params: OAuthLoginParams): OAuthLoginResult {
    cleanupExpiredSessions();
    const clientId = resolveClientId(handler, params);
    const redirectUri = resolveRedirectUri(handler, params);
    const prompt = params.prompt;

    const oauthInstance = new handler.oauthClass!({ clientId, redirectUri, prompt });

    const pkce = generatePKCE();
    saveOAuthSessionDB({
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        clientId,
        redirectUri,
        createdAt: Date.now(),
    });

    const authorizeUrl = oauthInstance.getAuthorizationUrl(pkce);

    return {
        authorizeUrl,
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
    };
}

async function processOAuthCallbackFor(handler: AuthProviderHandler, code: string, state: string): Promise<ProviderConfig> {
    cleanupExpiredSessions();

    const session = getOAuthSessionDB(state);
    if (!session) {
        throw new Error("Invalid or expired OAuth state parameter");
    }

    deleteOAuthSessionDB(state);

    const oauthInstance = new handler.oauthClass!({
        clientId: session.clientId,
        redirectUri: session.redirectUri,
    });

    const rawTokens = await oauthInstance.exchangeCodeForTokens(code, session.codeVerifier);
    const tokens = handler.mapOAuthTokens?.(rawTokens) ?? {
        accessToken: rawTokens.accessToken,
        refreshToken: rawTokens.refreshToken,
        expiresIn: rawTokens.expiresIn,
    };

    const timestamp = Date.now();
    const { accountId, accountName } = buildAccountIdentity(handler, timestamp);

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
        tokenExpiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        lastRefreshedAt: Date.now(),
        enabled: true,
        createdAt: timestamp,
    });

    const providerInstance = handler.buildExecutor({
        id: accountId,
        name: accountName,
        accountId: tokens.accountId,
        baseUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
    });
    registry.registerProvider(providerInstance);

    return providerConfig;
}

function processTokenImportFor(handler: AuthProviderHandler, params: TokenImportParams): ProviderConfig {
    const timestamp = Date.now();
    const accountId = params.id || `${handler.idPrefix}_${timestamp}`;
    const providerName = params.name || `${handler.displayName} (Account #${timestamp.toString().slice(-4)})`;
    const mapping = handler.mapImportTokens?.(params) ?? {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        accountId: params.accountId,
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
        enabled: true,
        createdAt: timestamp,
    });

    const providerInstance = handler.buildExecutor({
        id: accountId,
        name: providerName,
        accountId: mapping.accountId,
        baseUrl: mapping.baseUrl ?? baseUrl,
        apiKey: mapping.apiKey,
        accessToken: mapping.accessToken,
        refreshToken: mapping.refreshToken,
    });
    registry.registerProvider(providerInstance);

    return providerConfig;
}

// --- Public API (thin adapters, names preserved so routes/index.ts stay unchanged) ---

export class AuthLogic {
    // OpenAI Codex OAuth
    public static initiateOAuthPKCE(params: OAuthLoginParams): OAuthLoginResult {
        return initiatePKCEFor(openaiCodexAuthHandler, params);
    }

    public static async processOAuthCallback(code: string, state: string): Promise<ProviderConfig> {
        return processOAuthCallbackFor(openaiCodexAuthHandler, code, state);
    }

    public static processTokenImport(params: TokenImportParams): ProviderConfig {
        return processTokenImportFor(openaiCodexAuthHandler, params);
    }

    // Antigravity OAuth
    public static initiateAntigravityOAuthPKCE(params: OAuthLoginParams): OAuthLoginResult {
        return initiatePKCEFor(antigravityAuthHandler, params);
    }

    public static async processAntigravityOAuthCallback(code: string, state: string): Promise<ProviderConfig> {
        return processOAuthCallbackFor(antigravityAuthHandler, code, state);
    }

    public static processAntigravityTokenImport(params: TokenImportParams): ProviderConfig {
        return processTokenImportFor(antigravityAuthHandler, params);
    }

    // CommandCode (API key)
    public static processCommandCodeTokenImport(params: TokenImportParams): ProviderConfig {
        return processTokenImportFor(commandCodeAuthHandler, params);
    }

    // Anthropic (API key)
    public static processAnthropicTokenImport(params: TokenImportParams): ProviderConfig {
        return processTokenImportFor(anthropicAuthHandler, params);
    }
}
