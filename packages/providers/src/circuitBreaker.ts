export type ProviderHealthState = "healthy" | "cooldown" | "exhausted";

export interface ProviderHealthInfo {
    providerId: string;
    state: ProviderHealthState;
    consecutiveFailures: number;
    lastFailureTime?: number;
    lastSuccessTime?: number;
    lastErrorMessage?: string;
    cooldownUntil?: number;
}

const DEFAULT_COOLDOWN_MS = 30_000; // 30 seconds default cooldown for rate-limited accounts
const MAX_COOLDOWN_MS = 5 * 60_000; // 5 minutes max cooldown

const RATE_LIMIT_OR_QUOTA_PATTERNS = [
    /rate\s*limit/i,
    /too\s+many\s+requests/i,
    /quota\s*(exceeded|exhausted|limit)/i,
    /resource\s*exhausted/i,
    /capacity/i,
    /high\s+traffic/i,
    /temporarily\s+unavailable/i
];

function isRateLimitOrQuotaError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return RATE_LIMIT_OR_QUOTA_PATTERNS.some((p) => p.test(msg));
}

export class CircuitBreaker {
    private healthMap: Map<string, ProviderHealthInfo> = new Map();
    private defaultCooldownMs: number;

    constructor(defaultCooldownMs = DEFAULT_COOLDOWN_MS) {
        this.defaultCooldownMs = defaultCooldownMs;
    }

    public getHealth(providerId: string): ProviderHealthInfo {
        let health = this.healthMap.get(providerId);
        if (!health) {
            health = {
                providerId,
                state: "healthy",
                consecutiveFailures: 0
            };
            this.healthMap.set(providerId, health);
        }

        // Auto-recover if cooldown period has elapsed
        if (health.cooldownUntil && Date.now() >= health.cooldownUntil) {
            health.state = "healthy";
            health.cooldownUntil = undefined;
        }

        return health;
    }

    public isAvailable(providerId: string): boolean {
        const health = this.getHealth(providerId);
        return health.state === "healthy";
    }

    public recordSuccess(providerId: string): void {
        const health = this.getHealth(providerId);
        health.state = "healthy";
        health.consecutiveFailures = 0;
        health.lastSuccessTime = Date.now();
        health.cooldownUntil = undefined;
        health.lastErrorMessage = undefined;
    }

    public recordFailure(providerId: string, error: unknown, retryAfterMs?: number): void {
        const health = this.getHealth(providerId);
        const now = Date.now();
        health.consecutiveFailures += 1;
        health.lastFailureTime = now;
        health.lastErrorMessage = error instanceof Error ? error.message : String(error);

        let cooldownDuration = retryAfterMs;
        if (cooldownDuration === undefined || cooldownDuration <= 0) {
            // Exponential backoff based on consecutive failures
            const multiplier = Math.min(Math.pow(2, health.consecutiveFailures - 1), 10);
            cooldownDuration = Math.min(this.defaultCooldownMs * multiplier, MAX_COOLDOWN_MS);
        }

        health.state = isRateLimitOrQuotaError(error) ? "cooldown" : "cooldown";
        health.cooldownUntil = now + cooldownDuration;
    }

    public reset(providerId?: string): void {
        if (providerId) {
            this.healthMap.delete(providerId);
        } else {
            this.healthMap.clear();
        }
    }

    /**
     * Filters candidate providers by health, prioritizing healthy ones.
     * If all candidates are in cooldown, returns candidate with nearest cooldown expiration.
     */
    public sortCandidatesByHealth<T extends { id: string }>(candidates: T[]): T[] {
        if (candidates.length <= 1) return candidates;

        const now = Date.now();
        const available: T[] = [];
        const inCooldown: { candidate: T; remainingMs: number }[] = [];

        for (const candidate of candidates) {
            const health = this.getHealth(candidate.id);
            if (health.state === "healthy") {
                available.push(candidate);
            } else {
                const remainingMs = Math.max(0, (health.cooldownUntil ?? now) - now);
                inCooldown.push({ candidate, remainingMs });
            }
        }

        if (available.length > 0) {
            return available;
        }

        // All candidates are in cooldown: sort by shortest remaining wait time
        inCooldown.sort((a, b) => a.remainingMs - b.remainingMs);
        return inCooldown.map((item) => item.candidate);
    }
}

export const circuitBreaker = new CircuitBreaker();
