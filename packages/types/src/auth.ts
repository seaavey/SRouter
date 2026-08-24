import type { AIProvider, ProviderCategory, ProviderProtocol } from "./provider.js";

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

export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    accountId?: string;
    organizationId?: string;
    expiresIn?: number;
}

export type ExecutorFactory = (args: {
    id: string;
    name: string;
    accountId?: string;
    organizationId?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
}) => AIProvider;

export interface OAuthClientClass {
    new (options?: any): {
        getAuthorizationUrl?(pkce: { codeChallenge: string; state: string }): string;
        exchangeCodeForTokens?(code: string, codeVerifier: string): Promise<OAuthTokens>;
        refreshTokens?(refreshToken: string): Promise<OAuthTokens>;
        [key: string]: any;
    };
}

export interface ImportTokenMapping {
    accessToken?: string;
    refreshToken?: string;
    accountId?: string;
    organizationId?: string;
    baseUrl?: string;
    apiKey?: string;
}

export interface AuthProviderHandler {
    providerId: string;
    displayName: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    idPrefix: string;
    clientId?: () => string | undefined;
    defaultRedirectUri?: string;
    baseUrl?: () => string | undefined;
    oauthSuccessMessage: string;
    tokenImportMessage: string;
    mapOAuthTokens?: (tokens: OAuthTokens) => {
        accessToken: string;
        refreshToken?: string;
        accountId?: string;
        organizationId?: string;
        expiresIn?: number;
        baseUrl?: string;
    };
    mapImportTokens?: (params: TokenImportParams) => ImportTokenMapping;
    buildExecutor: ExecutorFactory;
    oauthClass?: OAuthClientClass;
}

export interface OAuthCallbackBody {
    code?: string;
    state?: string;
    callbackUrl?: string;
}

export interface TokenImportBody {
    accessToken: string;
    refreshToken?: string;
    baseUrl?: string;
    name?: string;
}
