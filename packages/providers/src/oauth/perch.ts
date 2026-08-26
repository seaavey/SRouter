import { PERCH_OAUTH_REDIRECT_URI, PERCH_SUPABASE_ANON_KEY, PERCH_SUPABASE_URL } from "@srouter/constants";
import type { OAuthTokenResponse, PKCEPair } from "./base.js";

export interface PerchOAuthOptions {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    redirectUri?: string;
    provider?: string;
}

export class PerchOAuth {
    private supabaseUrl: string;
    private supabaseAnonKey: string;
    private redirectUri: string;
    private provider: string;

    constructor(options: PerchOAuthOptions = {}) {
        this.supabaseUrl = (options.supabaseUrl ?? PERCH_SUPABASE_URL).replace(/\/$/, "");
        this.supabaseAnonKey = options.supabaseAnonKey ?? PERCH_SUPABASE_ANON_KEY;
        this.redirectUri = options.redirectUri ?? PERCH_OAUTH_REDIRECT_URI;
        this.provider = options.provider ?? "google";
    }

    getAuthorizationUrl(pkce: PKCEPair, redirectUri?: string): string {
        const targetRedirectUri = redirectUri || this.redirectUri;
        const params = new URLSearchParams({
            provider: this.provider,
            redirect_to: targetRedirectUri,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: "s256"
        });

        return `${this.supabaseUrl}/auth/v1/authorize?${params.toString()}`;
    }

    async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokenResponse> {
        const payload: Record<string, string> = {
            auth_code: code,
            code_verifier: codeVerifier ?? ""
        };

        const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
            method: "POST",
            headers: {
                apikey: this.supabaseAnonKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Perch PKCE code exchange failed (${res.status}): ${err}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            token_type?: string;
            user?: { id?: string; email?: string };
        };

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type ?? "Bearer",
            accountId: data.user?.id
        };
    }

    async refreshToken(refreshToken: string): Promise<OAuthTokenResponse> {
        const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: {
                apikey: this.supabaseAnonKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Perch refresh token failed (${res.status}): ${err}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            token_type?: string;
            user?: { id?: string; email?: string };
        };

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type ?? "Bearer",
            accountId: data.user?.id
        };
    }
}
