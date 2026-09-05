import type { AIProvider, ProviderCategory, ProviderConfig, ProviderProtocol } from "./provider.js";
import type { TokenImportBody } from "./schemas/auth.js";

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

export type TokenImportParams = TokenImportBody & {
    id?: string;
    account_id?: string;
};

export interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    account_id?: string;
    organization_id?: string;
    expires_in?: number;
    id_token?: string;
}

export type ExecutorFactory = (
    args: Pick<
        ProviderConfig,
        | "id"
        | "name"
        | "accountId"
        | "organizationId"
        | "apiKey"
        | "accessToken"
        | "refreshToken"
    > & {
        baseUrl?: string;
    }
) => AIProvider;

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
    mapOAuthTokens?: (tokens: OAuthTokens) => ImportTokenMapping & {
        expiresIn?: number;
    };
    mapImportTokens?: (params: TokenImportParams) => ImportTokenMapping;
    buildExecutor: ExecutorFactory;
    oauthClass?: OAuthClientClass;
}

export * from "./schemas/auth.js";
