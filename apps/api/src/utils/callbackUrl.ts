/**
 * Resolve the externally reachable base URL for OAuth callback redirects.
 *
 * Local development uses the dedicated OAuth listener on 127.0.0.1:1455, so
 * redirect URIs stay `http://localhost:1455/...`. When the gateway runs behind
 * a public origin (Heroku, VPS, tunnel) set SROUTER_PUBLIC_URL (e.g.
 * `https://srouter.example.com`) so authorize URLs point back at the main
 * server (`/v1/auth/.../callback`), where the callback routes already live.
 */
export function GetPublicUrlBase(): string | undefined {
    const value = process.env.SROUTER_PUBLIC_URL?.trim();
    return value ? value.replace(/\/+$/, "") : undefined;
}

/**
 * Rewrites a localhost/127.0.0.1 OAuth redirect URI to the public origin when
 * SROUTER_PUBLIC_URL is configured. Non-local URIs (user-supplied custom
 * callbacks) pass through untouched.
 */
export function ResolveCallbackUrl(redirectUri: string): string {
    const publicBase = GetPublicUrlBase();
    if (!publicBase) return redirectUri;

    try {
        const url = new URL(redirectUri);
        const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        if (isLocalhost) {
            // Already a main-server /v1 path — don't double-prefix.
            const path = url.pathname.startsWith("/v1") ? url.pathname : `/v1${url.pathname}`;
            return `${publicBase}${path}`;
        }
    } catch {
        // Malformed URI: leave as-is and let the caller surface the error.
    }

    return redirectUri;
}
