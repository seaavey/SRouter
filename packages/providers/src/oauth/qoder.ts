import { QODER_DEVICE_TOKEN_URL, QODER_LOGIN_URL, QODER_USERINFO_URL } from "@srouter/constants";
import { AuthPollStatus } from "@srouter/types";
import type { OAuthTokenResponse, PKCEPair } from "./base.js";

export interface QoderOAuthOptions {
    loginUrl?: string;
    deviceTokenUrl?: string;
    userInfoUrl?: string;
}

export class QoderOAuth {
    private loginUrl: string;
    private deviceTokenUrl: string;
    private userInfoUrl: string;

    constructor(options: QoderOAuthOptions = {}) {
        this.loginUrl = options.loginUrl ?? QODER_LOGIN_URL;
        this.deviceTokenUrl = options.deviceTokenUrl ?? QODER_DEVICE_TOKEN_URL;
        this.userInfoUrl = options.userInfoUrl ?? QODER_USERINFO_URL;
    }

    getAuthorizationUrl(pkce: PKCEPair, machineId = "srouter-device"): string {
        const params = new URLSearchParams({
            challenge: pkce.codeChallenge,
            challenge_method: "S256",
            machine_id: machineId,
            nonce: pkce.state
        });
        return `${this.loginUrl}?${params.toString()}`;
    }

    async pollDeviceToken(params: { nonce: string; codeVerifier: string }): Promise<{
        status: AuthPollStatus;
        accessToken?: string;
        refreshToken?: string;
        userId?: string;
        expiresIn?: number;
    }> {
        const url = `${this.deviceTokenUrl}?nonce=${encodeURIComponent(params.nonce)}&verifier=${encodeURIComponent(params.codeVerifier)}&challenge_method=S256`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json",
                "User-Agent": "qodercli/1.0.0"
            }
        });

        if (response.status === 202 || response.status === 404) {
            return { status: AuthPollStatus.PENDING };
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Qoder device token poll failed (${response.status}): ${text}`);
        }

        const body = (await response.json()) as {
            token?: string;
            refresh_token?: string;
            user_id?: string;
            expires_at?: string | number;
            expires_in?: number;
        };

        if (!body.token) {
            throw new Error("Qoder device token poll returned empty token");
        }

        let expiresIn = 30 * 24 * 60 * 60; // 30 days default
        if (typeof body.expires_in === "number" && body.expires_in > 0) {
            expiresIn = body.expires_in;
        } else if (body.expires_at) {
            const parsed =
                typeof body.expires_at === "number" ? body.expires_at : Date.parse(body.expires_at);
            if (!Number.isNaN(parsed) && parsed > Date.now()) {
                expiresIn = Math.floor((parsed - Date.now()) / 1000);
            }
        }

        return {
            status: AuthPollStatus.OK,
            accessToken: body.token,
            refreshToken: body.refresh_token,
            userId: body.user_id,
            expiresIn
        };
    }

    async fetchUserInfo(accessToken: string): Promise<{
        id: string;
        name: string;
        email: string;
        organizationId: string;
    }> {
        try {
            const response = await fetch(this.userInfoUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/json",
                    "User-Agent": "qodercli/1.0.0"
                }
            });
            if (!response.ok) return { id: "", name: "", email: "", organizationId: "" };
            const body = (await response.json()) as {
                id?: string;
                userId?: string;
                user_id?: string;
                name?: string;
                username?: string;
                email?: string;
                organization_id?: string;
            };
            return {
                id: body.id || body.userId || body.user_id || "",
                name: (body.name || body.username || "").trim(),
                email: (body.email || "").trim(),
                organizationId: (body.organization_id || "").trim()
            };
        } catch {
            return { id: "", name: "", email: "", organizationId: "" };
        }
    }

    /**
     * Generic OAuth token exchange implementation for SRouter framework.
     */
    async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
        const poll = await this.pollDeviceToken({ nonce: code, codeVerifier });
        if (poll.status !== AuthPollStatus.OK || !poll.accessToken) {
            throw new Error("Qoder authorization is still pending or was denied");
        }

        const userInfo = await this.fetchUserInfo(poll.accessToken);

        return {
            accessToken: poll.accessToken,
            refreshToken: poll.refreshToken,
            expiresIn: poll.expiresIn,
            tokenType: "Bearer",
            accountId: poll.userId || userInfo.id
        };
    }

    async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
        // Upstream refresh returns 403 for device tokens; return existing token
        return {
            accessToken: refreshToken,
            refreshToken,
            tokenType: "Bearer"
        };
    }
}
