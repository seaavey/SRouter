import { db, isPostgres } from "./db.js";
import { num, str } from "./row-utils.js";

export interface OAuthSession {
    state: string;
    codeVerifier?: string;
    deviceCode?: string;
    clientId?: string;
    redirectUri?: string;
    createdAt?: number;
    claimedAt?: number;
}

interface OAuthSessionRow {
    state: string;
    code_verifier: string;
    device_code: string | null;
    client_id: string;
    redirect_uri: string;
    created_at: number;
    claimed_at: number | null;
}

export async function saveOAuthSessionDB(session: OAuthSession): Promise<OAuthSession> {
    const UpsertSql = isPostgres()
        ? `INSERT INTO oauth_sessions (state, code_verifier, device_code, client_id, redirect_uri, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(state) DO UPDATE SET
               code_verifier = EXCLUDED.code_verifier,
               device_code = EXCLUDED.device_code,
               client_id = EXCLUDED.client_id,
               redirect_uri = EXCLUDED.redirect_uri,
               created_at = EXCLUDED.created_at`
        : `INSERT INTO oauth_sessions (state, code_verifier, device_code, client_id, redirect_uri, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(state) DO UPDATE SET
               code_verifier = excluded.code_verifier,
               device_code = excluded.device_code,
               client_id = excluded.client_id,
               redirect_uri = excluded.redirect_uri,
               created_at = excluded.created_at`;

    await db
        .prepare(UpsertSql)
        .run(
            session.state,
            session.codeVerifier ?? "",
            session.deviceCode ?? null,
            session.clientId ?? "",
            session.redirectUri ?? "",
            session.createdAt ?? Date.now()
        );

    return session;
}

export async function getOAuthSessionDB(state: string): Promise<OAuthSession | null> {
    const Row = (await db
        .prepare("SELECT * FROM oauth_sessions WHERE state = ?")
        .get(state)) as unknown as OAuthSessionRow | undefined;

    if (!Row) return null;

    return {
        state: str(Row.state),
        codeVerifier: str(Row.code_verifier),
        deviceCode: Row.device_code === null ? undefined : str(Row.device_code),
        clientId: str(Row.client_id),
        redirectUri: str(Row.redirect_uri),
        createdAt: num(Row.created_at),
        claimedAt: Row.claimed_at === null ? undefined : num(Row.claimed_at)
    };
}

export async function claimOAuthSessionDB(
    state: string,
    now = Date.now()
): Promise<OAuthSession | null> {
    const Result = await db
        .prepare("UPDATE oauth_sessions SET claimed_at = ? WHERE state = ? AND claimed_at IS NULL")
        .run(now, state);
    if (num(Result.changes) === 0) return null;
    return getOAuthSessionDB(state);
}

export async function releaseOAuthSessionDB(state: string): Promise<boolean> {
    const Result = await db
        .prepare("UPDATE oauth_sessions SET claimed_at = NULL WHERE state = ?")
        .run(state);
    return num(Result.changes) > 0;
}

export async function deleteOAuthSessionDB(state: string): Promise<boolean> {
    const Result = await db.prepare("DELETE FROM oauth_sessions WHERE state = ?").run(state);
    return num(Result.changes) > 0;
}

export async function cleanupExpiredOAuthSessionsDB(maxAgeMs: number): Promise<void> {
    const Cutoff = Date.now() - maxAgeMs;
    await db.prepare("DELETE FROM oauth_sessions WHERE created_at < ?").run(Cutoff);
}
