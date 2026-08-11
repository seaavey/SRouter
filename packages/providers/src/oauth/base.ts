import crypto from "node:crypto";

export interface OAuthTokenResponse {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn?: number;
    tokenType: string;
    /** Optional ChatGPT/OpenAI account identifier (for multi-account binding) */
    accountId?: string;
}

export interface PKCEPair {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
}

/**
 * Generates PKCE code_verifier and S256 code_challenge
 */
export function generatePKCE(): PKCEPair {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const state = crypto.randomBytes(16).toString("base64url");
    const hash = crypto.createHash("sha256").update(codeVerifier).digest();
    const codeChallenge = hash.toString("base64url");

    return {
        codeVerifier,
        codeChallenge,
        state,
    };
}
