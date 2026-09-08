import { findMatchingFallbackRulesDB } from "@srouter/db";
import { ensureFreshToken } from "@/services/tokenRefresh.js";
import {
    type CandidateModel,
    type ErrorWithStatus,
    ShouldTriggerFallback
} from "./fallback.policy.js";

export interface AttemptTracker {
    fallbackPath: string[];
    fallbackOccurred: boolean;
    fallbackReason?: string;
    lastError: Error | ErrorWithStatus | string | null;
}

export interface CandidateAttempt {
    candidate: CandidateModel;
    currentModel: string;
    isFallbackAttempt: boolean;
    providerId: string;
}

export async function ResolveCandidates(originalModel: string): Promise<CandidateModel[]> {
    const matchingRules = await findMatchingFallbackRulesDB(originalModel);
    const candidates: CandidateModel[] = [{ model: originalModel }];
    const visitedModels = new Set<string>([originalModel]);

    for (const rule of matchingRules) {
        if (!visitedModels.has(rule.targetModel)) {
            visitedModels.add(rule.targetModel);
            candidates.push({ model: rule.targetModel, rule });
        }
    }
    return candidates;
}

export async function* RunCandidateAttempts(
    originalModel: string,
    tracker: AttemptTracker
): AsyncGenerator<CandidateAttempt, void, void> {
    const candidates = await ResolveCandidates(originalModel);

    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (!candidate) continue;
        const isFallbackAttempt = index > 0;

        if (isFallbackAttempt && candidate.rule && tracker.lastError) {
            if (!ShouldTriggerFallback(candidate.rule, tracker.lastError)) continue;
        }

        const providerId = candidate.model.split("/")[0] || "default";
        try {
            await ensureFreshToken(providerId);
        } catch (error) {
            tracker.lastError = error instanceof Error ? error : String(error);
            if (!tracker.fallbackReason) {
                tracker.fallbackReason = error instanceof Error ? error.message : String(error);
            }
            continue;
        }
        yield {
            candidate,
            currentModel: candidate.model,
            isFallbackAttempt,
            providerId
        };
    }
}
