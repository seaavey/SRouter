import type { FallbackRule } from "@srouter/types";

export interface CandidateModel {
    model: string;
    rule?: FallbackRule;
}

export interface ErrorWithStatus {
    status?: number;
    statusCode?: number;
    message?: string;
}

export function ExtractStatusCode(
    err: Error | ErrorWithStatus | string | null | undefined
): number | undefined {
    if (!err) return undefined;
    if (typeof err === "object") {
        if ("status" in err && typeof err.status === "number") {
            return err.status;
        }
        if ("statusCode" in err && typeof err.statusCode === "number") {
            return err.statusCode;
        }
    }
    const msg = typeof err === "string" ? err : err.message || String(err);
    if (
        /no active provider connection|not found|unknown model|invalid model|no provider found/i.test(
            msg
        )
    ) {
        return 404;
    }
    const match = msg.match(/\b(400|401|402|403|404|408|409|422|429|500|502|503|504)\b/);
    if (match) return parseInt(match[1]!, 10);
    return undefined;
}

export function ShouldTriggerFallback(
    rule: FallbackRule,
    err: Error | ErrorWithStatus | string | null | undefined
): boolean {
    if (!rule.enabled) return false;
    if (!rule.triggerOnStatus || rule.triggerOnStatus.length === 0) return true;
    const status = ExtractStatusCode(err);
    if (status && rule.triggerOnStatus.includes(status)) return true;
    const msg = typeof err === "string" ? err : err ? err.message || String(err) : "";
    if (
        /rate\s*limit|too\s+many\s+requests|quota|exhausted|capacity|high\s+traffic|overloaded|no active provider connection|not found|unknown model|invalid model|no provider found|insufficient tokens|insufficient_quota|billing_error/i.test(
            msg
        )
    ) {
        return true;
    }
    return status === undefined;
}
