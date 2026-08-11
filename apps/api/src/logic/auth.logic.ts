import {
    cleanupExpiredOAuthSessionsDB,
    deleteOAuthSessionDB,
    getOAuthSessionDB,
    saveOAuthSessionDB,
    upsertProviderDB,
} from "@srouter/db";
import { AntigravityExecutor, AnthropicExecutor, CodexExecutor, CommandCodeExecutor, OpenAIExecutor } from "@srouter/executors";
import { AntigravityOAuth, OpenAICodexOAuth, generatePKCE, type PKCEPair } from "@srouter/providers";
import type { ProviderConfig } from "@srouter/types";
import { registry } from "@/services/registry.js";

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

const PKCE_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function cleanupExpiredSessions(): void {
    cleanupExpiredOAuthSessionsDB(PKCE_SESSION_MAX_AGE_MS);
}

export class AuthLogic {
    public static initiateOAuthPKCE(params: OAuthLoginParams): OAuthLoginResult {
        cleanupExpiredSessions();
        const clientId = params.clientId || "app_EMoamEEZ73f0CkXaXp7hrann";
        const redirectUri = params.redirectUri || "http://localhost:1455/auth/callback";
        const prompt = params.prompt;

        const oauthInstance = new OpenAICodexOAuth({
            clientId,
            redirectUri,
            prompt,
        });

        const pkce: PKCEPair = generatePKCE();
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

    public static async processOAuthCallback(code: string, state: string): Promise<ProviderConfig> {
        cleanupExpiredSessions();

        const session = getOAuthSessionDB(state);
        if (!session) {
            throw new Error("Invalid or expired OAuth state parameter");
        }

        deleteOAuthSessionDB(state);

        const oauthInstance = new OpenAICodexOAuth({
            clientId: session.clientId,
            redirectUri: session.redirectUri,
        });

        const tokens = await oauthInstance.exchangeCodeForTokens(code, session.codeVerifier);
        const timestamp = Date.now();
        const accountId = `openai_codex_${timestamp}`;
        const accountName = `OpenAI Codex (Account #${timestamp.toString().slice(-4)})`;

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "openai_codex",
            name: accountName,
            category: "oauth",
            protocol: "openai",
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accountId: tokens.accountId,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new CodexExecutor({
            id: accountId,
            name: accountName,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accountId: tokens.accountId,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }

    public static processTokenImport(params: TokenImportParams): ProviderConfig {
        const timestamp = Date.now();
        const accountId = params.id || `openai_codex_${timestamp}`;
        const providerName = params.name || `OpenAI Codex (Account #${timestamp.toString().slice(-4)})`;

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "openai_codex",
            name: providerName,
            category: "oauth",
            protocol: "openai",
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            accountId: params.accountId,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new CodexExecutor({
            id: accountId,
            name: providerName,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            accountId: params.accountId,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }

    // --- Antigravity OAuth ---
    public static initiateAntigravityOAuthPKCE(params: OAuthLoginParams): OAuthLoginResult {
        cleanupExpiredSessions();
        const clientId = params.clientId || process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

        const redirectUri = params.redirectUri || "http://localhost:1455/auth/antigravity/callback";
        const prompt = params.prompt;

        const oauthInstance = new AntigravityOAuth({
            clientId,
            redirectUri,
            prompt,
        });

        const pkce: PKCEPair = generatePKCE();
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

    public static async processAntigravityOAuthCallback(code: string, state: string): Promise<ProviderConfig> {
        cleanupExpiredSessions();

        const session = getOAuthSessionDB(state);
        if (!session) {
            throw new Error("Invalid or expired OAuth state parameter");
        }

        deleteOAuthSessionDB(state);

        const oauthInstance = new AntigravityOAuth({
            clientId: session.clientId,
            redirectUri: session.redirectUri,
        });

        const tokens = await oauthInstance.exchangeCodeForTokens(code, session.codeVerifier);
        const timestamp = Date.now();
        const accountId = `antigravity_${timestamp}`;
        const accountName = `Antigravity (Account #${timestamp.toString().slice(-4)})`;
        const token = tokens.accessToken || "";
        const baseUrl = process.env.ANTIGRAVITY_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "antigravity",
            name: accountName,
            category: "oauth",
            protocol: "openai",
            baseUrl,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new AntigravityExecutor({
            id: accountId,
            name: accountName,
            baseUrl,
            accessToken: tokens.accessToken,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }

    public static processAntigravityTokenImport(params: TokenImportParams): ProviderConfig {
        const timestamp = Date.now();
        const accountId = params.id || `antigravity_${timestamp}`;
        const providerName = params.name || `Antigravity (Account #${timestamp.toString().slice(-4)})`;
        const baseUrl = params.baseUrl || process.env.ANTIGRAVITY_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "antigravity",
            name: providerName,
            category: "oauth",
            protocol: "openai",
            baseUrl,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new AntigravityExecutor({
            id: accountId,
            name: providerName,
            baseUrl,
            accessToken: params.accessToken,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }

    // --- CommandCode Provider (API key) ---
    public static processCommandCodeTokenImport(params: TokenImportParams): ProviderConfig {
        const timestamp = Date.now();
        const accountId = params.id || `commandcode_${timestamp}`;
        const providerName = params.name || `Command Code (Account #${timestamp.toString().slice(-4)})`;
        const baseUrl = params.baseUrl || process.env.COMMANDCODE_BASE_URL || "https://api.commandcode.ai/alpha/generate";

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "commandcode",
            name: providerName,
            category: "api_key",
            protocol: "openai",
            baseUrl,
            apiKey: params.accessToken,
            refreshToken: params.refreshToken,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new CommandCodeExecutor({
            id: accountId,
            name: providerName,
            baseUrl,
            apiKey: params.accessToken,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }

    // --- Anthropic Provider (API key / access token) ---
    public static processAnthropicTokenImport(params: TokenImportParams): ProviderConfig {
        const timestamp = Date.now();
        const accountId = params.id || `anthropic_${timestamp}`;
        const providerName = params.name || `Anthropic (Account #${timestamp.toString().slice(-4)})`;
        const baseUrl = params.baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1";

        const providerConfig = upsertProviderDB({
            id: accountId,
            providerId: "anthropic",
            name: providerName,
            category: "api_key",
            protocol: "anthropic",
            baseUrl,
            apiKey: params.accessToken,
            refreshToken: params.refreshToken,
            enabled: true,
            createdAt: timestamp,
        });

        const providerInstance = new AnthropicExecutor({
            id: accountId,
            name: providerName,
            baseUrl,
            apiKey: params.accessToken,
        });
        registry.registerProvider(providerInstance);

        return providerConfig;
    }
}
