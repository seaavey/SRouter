export const DEFAULT_REQUEST_ATTEMPT_LIMIT = 6;

export interface RequestAttemptBudget {
    readonly limit: number;
    readonly used: number;
    readonly remaining: number;
    readonly providerAttempts: number;
    readonly transportAttempts: number;
    consume(): void;
    recordProviderAttempt(): void;
}

class AttemptBudget implements RequestAttemptBudget {
    public used = 0;
    public providerAttempts = 0;
    public transportAttempts = 0;

    public constructor(public readonly limit: number) {}

    public get remaining(): number {
        return Math.max(0, this.limit - this.used);
    }

    public consume(): void {
        if (this.remaining <= 0) {
            throw new Error(
                `Request upstream attempt budget exhausted after ${this.limit} attempts`
            );
        }
        this.used += 1;
        this.transportAttempts += 1;
    }

    public recordProviderAttempt(): void {
        this.providerAttempts += 1;
    }
}

export function CreateRequestAttemptBudget(
    limit = DEFAULT_REQUEST_ATTEMPT_LIMIT
): RequestAttemptBudget {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("Request attempt limit must be a positive integer");
    }
    return new AttemptBudget(limit);
}
