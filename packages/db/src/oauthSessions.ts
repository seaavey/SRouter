import { db } from "./db.js";
import { num, str } from "./row-utils.js";

export interface OAuthSession {
    state: string;
    codeVerifier?: string;
    clientId?: string;
    redirectUri?: string;
    createdAt?: number;
}

export function saveOAuthSessionDB(session: OAuthSession): OAuthSession {
    db.prepare(
        `INSERT INTO oauth_sessions (state, code_verifier, client_id, redirect_uri, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(state) DO UPDATE SET
             code_verifier = excluded.code_verifier,
             client_id = excluded.client_id,
             redirect_uri = excluded.redirect_uri,
             created_at = excluded.created_at;`
    ).run(
        session.state,
        session.codeVerifier ?? "",
        session.clientId ?? "",
        session.redirectUri ?? "",
        session.createdAt ?? Date.now()
    );

    return session;
}

export function getOAuthSessionDB(state: string): OAuthSession | null {
    const row = db.prepare("SELECT * FROM oauth_sessions WHERE state = ?").get(state);

    if (!row) return null;

    return {
        state: str(row.state),
        codeVerifier: str(row.code_verifier),
        clientId: str(row.client_id),
        redirectUri: str(row.redirect_uri),
        createdAt: num(row.created_at)
    };
}

export function deleteOAuthSessionDB(state: string): boolean {
    const result = db.prepare("DELETE FROM oauth_sessions WHERE state = ?").run(state);
    return (result.changes ?? 0) > 0;
}

export function cleanupExpiredOAuthSessionsDB(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    db.prepare("DELETE FROM oauth_sessions WHERE created_at < ?").run(cutoff);
}
