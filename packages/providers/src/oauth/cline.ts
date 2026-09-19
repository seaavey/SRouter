import {
    CLINE_API_ROOT,
    CLINE_BASE_URL,
    CLINE_WORKOS_BASE_URL,
    CLINE_WORKOS_CLIENT_ID
} from "@srouter/constants";
import { AuthPollStatus } from "@srouter/types";
import type { OAuthTokenResponse } from "./base.js";

interface DeviceResponse {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
}

interface WorkOSTokenResponse {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
}

interface ClineTokenResponse {
    success?: boolean;
    data?: {
        accessToken?: string;
        refreshToken?: string;
        tokenType?: string;
        expiresAt?: string;
        userInfo?: { clineUserId?: string | null; email?: string; name?: string };
    };
}

export interface ClineDeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    interval: number;
}

export interface ClineDevicePollResult {
    status: AuthPollStatus;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    accountId?: string;
    email?: string;
    name?: string;
    error?: string;
}

function ParseExpiresAt(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
}

export class ClineOAuth {
    async requestDeviceAuthorization(): Promise<ClineDeviceAuthorization> {
        const response = await fetch(`${CLINE_WORKOS_BASE_URL}/user_management/authorize/device`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: CLINE_WORKOS_CLIENT_ID })
        });
        const data = (await response.json().catch(() => ({}))) as DeviceResponse;
        if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
            throw new Error(`Cline device authorization failed (${response.status})`);
        }
        return {
            deviceCode: data.device_code,
            userCode: data.user_code,
            verificationUri: data.verification_uri,
            verificationUriComplete: data.verification_uri_complete,
            expiresIn: data.expires_in ?? 300,
            interval: data.interval ?? 5
        };
    }

    async pollDeviceToken(deviceCode: string): Promise<ClineDevicePollResult> {
        const response = await fetch(`${CLINE_WORKOS_BASE_URL}/user_management/authenticate`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                device_code: deviceCode,
                client_id: CLINE_WORKOS_CLIENT_ID
            })
        });
        const data = (await response.json().catch(() => ({}))) as WorkOSTokenResponse;
        if (!response.ok) {
            if (data.error === "authorization_pending" || data.error === "slow_down") {
                return { status: AuthPollStatus.PENDING };
            }
            return { status: AuthPollStatus.PENDING, error: data.error_description || data.error };
        }
        if (!data.access_token || !data.refresh_token) {
            return { status: AuthPollStatus.PENDING, error: "Invalid WorkOS token response" };
        }

        const registered = await fetch(`${CLINE_API_ROOT}/api/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                accessToken: data.access_token,
                refreshToken: data.refresh_token
            })
        });
        const payload = (await registered.json().catch(() => ({}))) as ClineTokenResponse;
        const token = payload.data;
        if (!registered.ok || !payload.success || !token?.accessToken || !token.refreshToken) {
            return {
                status: AuthPollStatus.PENDING,
                error: `Cline token registration failed (${registered.status})`
            };
        }
        const expiresAt = ParseExpiresAt(token.expiresAt);
        return {
            status: AuthPollStatus.OK,
            accessToken: `workos:${token.accessToken}`,
            refreshToken: token.refreshToken,
            expiresIn: expiresAt
                ? Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))
                : undefined,
            accountId: token.userInfo?.clineUserId ?? undefined,
            email: token.userInfo?.email,
            name: token.userInfo?.name
        };
    }

    async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
        const response = await fetch(`${CLINE_BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken, grantType: "refresh_token" })
        });
        const payload = (await response.json().catch(() => ({}))) as ClineTokenResponse;
        const token = payload.data;
        if (!response.ok || !payload.success || !token?.accessToken) {
            throw new Error(`Cline token refresh failed (${response.status})`);
        }
        const expiresAt = ParseExpiresAt(token.expiresAt);
        return {
            accessToken: `workos:${token.accessToken}`,
            refreshToken: token.refreshToken || refreshToken,
            expiresIn: expiresAt
                ? Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))
                : undefined,
            tokenType: token.tokenType || "Bearer",
            accountId: token.userInfo?.clineUserId ?? undefined
        };
    }
}
