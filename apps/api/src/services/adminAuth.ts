import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { adminAuthStore, type AdminAuthStore } from "@srouter/db";

export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_COOKIE = "srouter_admin_session";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_SCRYPT_N = 16_384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_SCRYPT_MAXMEM = 32 * 1024 * 1024;

export function validateAdminPassword(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0) {
        return "Password is required";
    }
    if (value.length > 128) {
        return "Password must be at most 128 characters";
    }
    return null;
}

export function hashAdminPassword(password: string): string {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const derivedKey = scryptSync(password, salt, PASSWORD_HASH_LENGTH, {
        N: PASSWORD_SCRYPT_N,
        r: PASSWORD_SCRYPT_R,
        p: PASSWORD_SCRYPT_P,
        maxmem: PASSWORD_SCRYPT_MAXMEM
    });

    return [
        PASSWORD_HASH_ALGORITHM,
        PASSWORD_SCRYPT_N,
        PASSWORD_SCRYPT_R,
        PASSWORD_SCRYPT_P,
        salt.toString("base64url"),
        derivedKey.toString("base64url")
    ].join("$");
}

export function verifyAdminPassword(password: string, storedHash: string): boolean {
    try {
        const parts = storedHash.split("$");
        if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_ALGORITHM) return false;

        const [, nValue, rValue, pValue, saltValue, hashValue] = parts;
        const n = Number(nValue);
        const r = Number(rValue);
        const p = Number(pValue);
        if (![n, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) {
            return false;
        }

        const salt = Buffer.from(saltValue, "base64url");
        const expected = Buffer.from(hashValue, "base64url");
        if (salt.length === 0 || expected.length === 0) return false;

        const actual = scryptSync(password, salt, expected.length, {
            N: n,
            r,
            p,
            maxmem: PASSWORD_SCRYPT_MAXMEM
        });
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

export function hashSessionToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createAdminSession(
    store: Pick<AdminAuthStore, "createSession"> = adminAuthStore,
    now = Date.now()
): string {
    const token = randomBytes(32).toString("base64url");
    store.createSession(hashSessionToken(token), now, now + ADMIN_SESSION_TTL_MS);
    return token;
}

export function verifyAdminSession(
    store: Pick<AdminAuthStore, "getSession"> = adminAuthStore,
    token: string | undefined,
    now = Date.now()
): boolean {
    if (!token) return false;
    return store.getSession(hashSessionToken(token), now) !== null;
}

export function revokeAdminSession(
    store: Pick<AdminAuthStore, "deleteSession"> = adminAuthStore,
    token: string | undefined
): boolean {
    if (!token) return false;
    return store.deleteSession(hashSessionToken(token));
}

export function isLoopbackAddress(address: string | undefined): boolean {
    if (!address) return false;
    const normalized = address.toLowerCase().replace(/^::ffff:/, "");
    return normalized === "127.0.0.1" || normalized === "::1";
}

/**
 * Bootstrap the admin account from the environment when requested.
 * - `SROUTER_ADMIN_PASSWORD` set → creates the account if missing, or resets
 *   the password on every boot (documented recovery path for a forgotten password).
 * - Not set → no account is auto-created. First-run setup happens through the
 *   dashboard ("create your admin password"), which is first-come-wins until
 *   an account exists.
 */
export function bootstrapAdminAccountFromEnv(
    store: AdminAuthStore,
    now: number = Date.now()
): void {
    const envPassword = process.env.SROUTER_ADMIN_PASSWORD;
    if (envPassword === undefined || envPassword.length === 0) return;

    const hash = hashAdminPassword(envPassword);
    if (!store.hasAdminAccount()) {
        store.createAdminAccount(hash, now);
    } else {
        store.updatePasswordHash(hash, now);
    }
}
