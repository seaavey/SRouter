import {
    ANTIGRAVITY_OAUTH_AUTHORIZE_URL,
    ANTIGRAVITY_OAUTH_CLIENT_ID,
    ANTIGRAVITY_OAUTH_CLIENT_SECRET,
    ANTIGRAVITY_OAUTH_PROMPT,
    ANTIGRAVITY_OAUTH_REDIRECT_URI,
    ANTIGRAVITY_OAUTH_SCOPE,
    ANTIGRAVITY_OAUTH_TOKEN_URL
} from "@srouter/constants";
import type { OAuthTokenResponse, PKCEPair } from "./base.js";

export interface AntigravityOAuthOptions {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scope?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    prompt?: string;
}

export class AntigravityOAuth {
    private clientId: string;
    private clientSecret?: string;
    private redirectUri: string;
    private scope: string;
    private authorizeUrl: string;
    private tokenUrl: string;
    private prompt?: string;

    constructor(options: AntigravityOAuthOptions = {}) {
        // Official Antigravity Google OAuth Public Client ID & Secret (used by 9router, opencode, OpenClaw)
        this.clientId = options.clientId ?? ANTIGRAVITY_OAUTH_CLIENT_ID;
        this.clientSecret = options.clientSecret ?? ANTIGRAVITY_OAUTH_CLIENT_SECRET;
        this.redirectUri = options.redirectUri ?? ANTIGRAVITY_OAUTH_REDIRECT_URI;
        this.scope = options.scope ?? ANTIGRAVITY_OAUTH_SCOPE;
        this.authorizeUrl = options.authorizeUrl ?? ANTIGRAVITY_OAUTH_AUTHORIZE_URL;
        this.tokenUrl = options.tokenUrl ?? ANTIGRAVITY_OAUTH_TOKEN_URL;
        this.prompt = options.prompt ?? ANTIGRAVITY_OAUTH_PROMPT;
    }

    /**
     * Generates PKCE parameters and returns authorization URL for Google Antigravity OAuth
     */
    getAuthorizationUrl(pkce: PKCEPair): string {
        const params: Record<string, string> = {
            response_type: "code",
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scope,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: "S256",
            state: pkce.state,
            access_type: "offline"
        };

        if (this.prompt) {
            params.prompt = this.prompt;
        }

        const queryString = Object.entries(params)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join("&");

        return `${this.authorizeUrl}?${queryString}`;
    }

    /**
     * Exchanges authorization code and code_verifier for Access Token
     */
    async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
        const params: Record<string, string> = {
            grant_type: "authorization_code",
            client_id: this.clientId,
            code,
            code_verifier: codeVerifier,
            redirect_uri: this.redirectUri
        };

        if (this.clientSecret) {
            params.client_secret = this.clientSecret;
        }

        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams(params)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Antigravity OAuth Exchange Failed (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            id_token?: string;
            expires_in?: number;
            token_type?: string;
        };

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            idToken: data.id_token,
            id_token: data.id_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type ?? "Bearer"
        };
    }

    /**
     * Refreshes an expired access token using refresh_token
     */
    async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
        const params: Record<string, string> = {
            grant_type: "refresh_token",
            client_id: this.clientId,
            refresh_token: refreshToken
        };

        if (this.clientSecret) {
            params.client_secret = this.clientSecret;
        }

        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams(params)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Antigravity OAuth Refresh Failed (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            token_type?: string;
        };

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken,
            expiresIn: data.expires_in,
            tokenType: data.token_type ?? "Bearer"
        };
    }
}
