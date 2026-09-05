import {
    CLAUDE_OAUTH_AUTHORIZE_URL,
    CLAUDE_OAUTH_CLIENT_ID,
    CLAUDE_OAUTH_REDIRECT_URI,
    CLAUDE_OAUTH_SCOPE,
    CLAUDE_OAUTH_TOKEN_URL
} from "@srouter/constants";
import type { OAuthTokenResponse, PKCEPair } from "./base.js";

export interface ClaudeOAuthOptions {
    clientId?: string;
    redirectUri?: string;
    scope?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    prompt?: string;
}

/**
 * Claude Code OAuth (port of 9router providers/registry/claude.js).
 * Allows a Claude subscription (claude.ai account) to be used via Claude Code OAuth
 * tokens — not just a raw API key.
 */
export class ClaudeOAuth {
    private clientId: string;
    private redirectUri: string;
    private scope: string;
    private authorizeUrl: string;
    private tokenUrl: string;
    private prompt?: string;

    constructor(options: ClaudeOAuthOptions = {}) {
        // Official Claude Code OAuth public client ID (mirrors claude-code CLI)
        this.clientId =
            options.clientId ?? process.env.CLAUDE_OAUTH_CLIENT_ID ?? CLAUDE_OAUTH_CLIENT_ID;
        this.redirectUri =
            options.redirectUri ??
            process.env.CLAUDE_OAUTH_REDIRECT_URI ??
            CLAUDE_OAUTH_REDIRECT_URI;
        this.scope = options.scope ?? process.env.CLAUDE_OAUTH_SCOPE ?? CLAUDE_OAUTH_SCOPE;
        this.authorizeUrl =
            options.authorizeUrl ??
            process.env.CLAUDE_OAUTH_AUTHORIZE_URL ??
            CLAUDE_OAUTH_AUTHORIZE_URL;
        this.tokenUrl =
            options.tokenUrl ?? process.env.CLAUDE_OAUTH_TOKEN_URL ?? CLAUDE_OAUTH_TOKEN_URL;
        this.prompt = options.prompt ?? process.env.CLAUDE_OAUTH_PROMPT;
    }

    /**
     * Generates PKCE parameters and returns authorization URL
     */
    getAuthorizationUrl(pkce: PKCEPair): string {
        const params: Record<string, string> = {
            response_type: "code",
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scope,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: "S256",
            state: pkce.state
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
     * Exchanges authorization code and code_verifier for Access Token.
     * Claude OAuth uses a JSON body (not form-encoded) with client_id only.
     */
    async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                grant_type: "authorization_code",
                client_id: this.clientId,
                code,
                code_verifier: codeVerifier,
                redirect_uri: this.redirectUri
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Claude OAuth Exchange Failed (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            id_token?: string;
            expires_in?: number;
            token_type?: string;
            organization_id?: string;
        };

        return {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            id_token: data.id_token,
            expires_in: data.expires_in,
            token_type: data.token_type ?? "Bearer",
            organization_id: data.organization_id
        };
    }

    /**
     * Refreshes an expired access token using refresh_token.
     * Claude OAuth: JSON body, client_id only, no client_secret.
     */
    async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                grant_type: "refresh_token",
                client_id: this.clientId,
                refresh_token: refreshToken
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Claude OAuth Refresh Failed (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            id_token?: string;
            expires_in?: number;
            token_type?: string;
            organization_id?: string;
        };

        return {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            id_token: data.id_token,
            expires_in: data.expires_in,
            token_type: data.token_type ?? "Bearer",
            organization_id: data.organization_id
        };
    }
}
