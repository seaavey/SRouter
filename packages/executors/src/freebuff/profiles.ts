export interface BrowserHeaders {
    readonly "User-Agent": string;
    readonly "Accept-Language": string;
    readonly "Accept-Encoding": string;
    readonly "Sec-CH-UA"?: string;
    readonly "Sec-CH-UA-Platform"?: string;
    readonly "Sec-Fetch-Site": "none";
    readonly "Sec-Fetch-Mode": "cors";
    readonly "Sec-Fetch-Dest": "empty";
    readonly "Upgrade-Insecure-Requests": "1";
}

interface BrowserProfile {
    readonly userAgent: string;
    readonly acceptLanguage: string;
    readonly secChUa?: string;
    readonly secChUaPlatform?: string;
}

const PROFILES: readonly BrowserProfile[] = [
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        acceptLanguage: "en-US,en;q=0.9",
        secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        secChUaPlatform: '"Windows"',
    },
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        acceptLanguage: "en-US,en;q=0.9",
    },
    {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        acceptLanguage: "en-US,en;q=0.8",
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
        acceptLanguage: "en-US,en;q=0.9",
    },
];

let profileCursor = 0;

/**
 * Returns a browser-like header set, rotating deterministically through known
 * profiles. This changes HTTP headers only; native fetch uses normal TLS and
 * this module makes no JA3 or TLS-fingerprint impersonation claim.
 */
export function nextBrowserHeaders(): BrowserHeaders {
    const profile = PROFILES[profileCursor % PROFILES.length];
    profileCursor += 1;
    return {
        "User-Agent": profile.userAgent,
        "Accept-Language": profile.acceptLanguage,
        "Accept-Encoding": "gzip, deflate, br",
        ...(profile.secChUa === undefined ? {} : { "Sec-CH-UA": profile.secChUa }),
        ...(profile.secChUaPlatform === undefined ? {} : { "Sec-CH-UA-Platform": profile.secChUaPlatform }),
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Upgrade-Insecure-Requests": "1",
    };
}

export const FREEBUFF_BROWSER_PROFILE_COUNT = PROFILES.length;
