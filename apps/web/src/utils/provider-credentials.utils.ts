/**
 * Mengekstrak identitas tampilan dari koneksi: nama koneksi eksplisit,
 * lalu email dari payload JWT (base64url, tanpa padding), atau fallback nama.
 *
 * Sebelumnya logika ini inline di komponen dan gagal diam-diam untuk payload
 * JWT tanpa padding; kini murni dan teruji di `tests/provider-jwt.test.mjs`.
 */
export function getConnectionDisplayName(
    connection: {
        name?: string | null;
        accessToken?: string | null;
        apiKey?: string | null;
    },
    fallbackName?: string
): string | undefined {
    if (connection.name && connection.name.includes("@")) {
        return connection.name;
    }

    const email = extractJwtEmail(connection.accessToken || connection.apiKey);
    if (email) return email;

    return connection.name ?? fallbackName;
}

/** Mengembalikan email dari payload JWT, atau undefined bila bukan JWT/email. */
export function extractJwtEmail(token: string | null | undefined): string | undefined {
    if (!token || !token.startsWith("eyJ")) return undefined;

    const parts = token.split(".");
    if (parts.length < 2) return undefined;

    try {
        const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
        return pickEmail(payload);
    } catch {
        return undefined;
    }
}

/** base64url → teks, dengan padding "=" yang dipangkas JWT ditambahkan kembali. */
function decodeBase64Url(segment: string): string {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return atob(padded);
}

function pickEmail(payload: Record<string, unknown>): string | undefined {
    const candidates = [
        payload.email,
        (payload["https://api.openai.com/profile"] as Record<string, unknown> | undefined)?.email,
        (payload.user_metadata as Record<string, unknown> | undefined)?.email,
        payload.preferred_username,
        payload.unique_name
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.includes("@")) {
            return candidate;
        }
    }
    return undefined;
}
