import type { OAuthTokenResponse, PKCEPair } from "./base.js";

export interface OpenAIOAuthOptions {
    clientId?: string;
    redirectUri?: string;
    scope?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    prompt?: string;
}

export class OpenAICodexOAuth {
    private clientId: string;
    private redirectUri: string;
    private scope: string;
    private authorizeUrl: string;
    private tokenUrl: string;
    private prompt?: string;
    private originator: string;

    constructor(options: OpenAIOAuthOptions = {}) {
        // Official OpenAI Codex OAuth public client ID (mirrors openai/codex auth URL)
        this.clientId = options.clientId ?? process.env.OPENAI_OAUTH_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann";
        this.redirectUri = options.redirectUri ?? process.env.OPENAI_OAUTH_REDIRECT_URI ?? "http://localhost:1455/auth/callback";
        // Mirrors the official Codex CLI scope set; the connector scopes are required for a valid consent
        this.scope = options.scope ?? "openid profile email offline_access api.connectors.read api.connectors.invoke";
        this.authorizeUrl = options.authorizeUrl ?? "https://auth.openai.com/oauth/authorize";
        this.tokenUrl = options.tokenUrl ?? "https://auth.openai.com/oauth/token";
        this.prompt = options.prompt ?? process.env.OPENAI_OAUTH_PROMPT;
        this.originator = process.env.OPENAI_OAUTH_ORIGINATOR ?? "codex_cli_rs";
    }

    /**
     * Generates PKCE parameters and returns authorization URL (matches official Codex CLI)
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
            // Required by OpenAI's Codex OAuth flow for a valid consent session
            id_token_add_organizations: "true",
            codex_cli_simplified_flow: "true",
            originator: this.originator,
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
        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                client_id: this.clientId,
                code,
                code_verifier: codeVerifier,
                redirect_uri: this.redirectUri,
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI OAuth Exchange Failed (${res.status}): ${errorText}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            id_token?: string;
            expires_in?: number;
            token_type?: string;
            chatgpt_account_id?: string;
            account_id?: string;
        };

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            idToken: data.id_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type ?? "Bearer",
            accountId: data.chatgpt_account_id || data.account_id || extractAccountIdFromIdToken(data.id_token),
        };
    }

    /**
     * Refreshes an expired access token using refresh_token
     */
    async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
        const res = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: this.clientId,
                refresh_token: refreshToken,
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI OAuth Refresh Failed (${res.status}): ${errorText}`);
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
            tokenType: data.token_type ?? "Bearer",
        };
    }
}

/**
 * Extract ChatGPT account identifier from an id_token JWT payload.
 * OpenAI id_tokens carry the account id in `sub` (e.g. "u_..." for ChatGPT).
 */
function extractAccountIdFromIdToken(idToken?: string): string | undefined {
    if (!idToken || typeof idToken !== "string") return undefined;
    const parts = idToken.split(".");
    if (parts.length < 2) return undefined;
    try {
        // JWT payload is base64url-encoded JSON
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
            sub?: string;
            "https://api.openai.com/auth"?: { user_id?: string };
            user_id?: string;
        };
        return payload["https://api.openai.com/auth"]?.user_id || payload.user_id || payload.sub;
    } catch {
        return undefined;
    }
}
