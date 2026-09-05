import type { AIProvider, ProviderCategory, ProviderConfig, ProviderProtocol } from "./provider.js";

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
    access_token?: string;
    accessToken?: string;
    refresh_token?: string;
    refreshToken?: string;
    account_id?: string;
    accountId?: string;
    base_url?: string;
    baseUrl?: string;
    name?: string;
    id_token?: string;
    idToken?: string;
}

export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    accountId?: string;
    organizationId?: string;
    expiresIn?: number;
    id_token?: string;
    idToken?: string;
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

export interface OAuthClientOptions {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scope?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    prompt?: string;
    stateUrl?: string;
    refreshUrl?: string;
    loginUrl?: string;
    deviceTokenUrl?: string;
    userInfoUrl?: string;
    platform?: string;
    userAgent?: string;
    origin?: string;
    domain?: string;
    ioa?: boolean;
    refreshBearer?: boolean;
}

export interface OAuthClientInstance {
    getAuthorizationUrl?(pkce: { codeChallenge: string; state: string }): string;
    exchangeCodeForTokens?(code: string, codeVerifier: string): Promise<OAuthTokens>;
    refreshTokens?(refreshToken: string): Promise<OAuthTokens>;
}

export interface OAuthClientClass {
    new (options?: OAuthClientOptions): OAuthClientInstance;
}

export type ImportTokenMapping = Pick<
    ProviderConfig,
    "accessToken" | "refreshToken" | "accountId" | "organizationId" | "apiKey"
> & {
    baseUrl?: string;
};

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

export * from "./schemas/auth.js";
