export const DEFAULT_REQUEST_ATTEMPT_LIMIT = 6;

export interface RequestAttemptBudget {
    readonly limit: number;
    readonly used: number;
    readonly remaining: number;
    consume(): void;
}

class AttemptBudget implements RequestAttemptBudget {
    public used = 0;

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
    }
}

const RequestAttemptBudgets = new WeakMap<object, RequestAttemptBudget>();

export function CreateRequestAttemptBudget(
    limit = DEFAULT_REQUEST_ATTEMPT_LIMIT
): RequestAttemptBudget {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("Request attempt limit must be a positive integer");
    }
    return new AttemptBudget(limit);
}

export function AttachRequestAttemptBudget<T extends object>(
    request: T,
    budget: RequestAttemptBudget
): T {
    RequestAttemptBudgets.set(request, budget);
    return request;
}

export function GetRequestAttemptBudget(request: object): RequestAttemptBudget | undefined {
    return RequestAttemptBudgets.get(request);
}
