import {
    findMatchingFallbackRulesDB,
    incrementAPIKeyUsageDB,
    logRequestDB
} from "@srouter/db";
import { isImageGenerationSupported } from "@srouter/pricing";
import type {
    FallbackRule,
    ImageGenerationRequest,
    ImageGenerationResponse
} from "@srouter/types";
import { HTTPException } from "hono/http-exception";
import { registry } from "@/services/registry.js";
import { ensureFreshToken } from "@/services/tokenRefresh.js";
import {
    type CandidateModel,
    type ErrorWithStatus,
    ExtractStatusCode,
    ShouldTriggerFallback
} from "./fallback.policy.js";

async function ResolveCandidates(model: string): Promise<CandidateModel[]> {
    const candidates: CandidateModel[] = [{ model }];
    const rules = await findMatchingFallbackRulesDB(model);

    for (const rule of rules) {
        if (!candidates.some((c) => c.model === rule.targetModel)) {
            candidates.push({ model: rule.targetModel, rule });
        }
    }

    return candidates;
}

export class ImagesLogic {
    public static async generate(
        body: ImageGenerationRequest,
        startTime: number,
        apiKeyId?: string,
        ipAddress?: string,
        userAgent?: string
    ): Promise<ImageGenerationResponse> {
        const model = body.model || "dall-e-3";
        const hasInputImage = Boolean(body.image || body.images);

        // 1. Modality capability validation
        if (!isImageGenerationSupported(model, hasInputImage)) {
            const reason = hasInputImage
                ? `Model '${model}' does not support image editing / image-to-image input.`
                : `Model '${model}' does not support image generation. Output modalities do not include 'image'.`;

            throw new HTTPException(400, {
                message: JSON.stringify({
                    error: {
                        message: reason,
                        type: "invalid_request_error",
                        param: "model",
                        code: "model_not_supported"
                    }
                })
            });
        }

        const candidates = await ResolveCandidates(model);
        let lastError: Error | ErrorWithStatus | string | null = null;
        const fallbackPath: string[] = [model];
        let fallbackOccurred = false;
        let fallbackReason: string | undefined;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            const isFallbackAttempt = i > 0;

            if (isFallbackAttempt && candidate.rule && lastError) {
                if (!ShouldTriggerFallback(candidate.rule, lastError)) {
                    continue;
                }
            }

            const currentModel = candidate.model;
            const currentReq: ImageGenerationRequest = { ...body, model: currentModel };
            const providerId = currentModel.split("/")[0] || "default";

            try {
                await ensureFreshToken(providerId);
                const response = await registry.generateImage(currentReq);

                if (isFallbackAttempt) {
                    fallbackOccurred = true;
                    fallbackPath.push(currentModel);
                }

                if (apiKeyId) {
                    incrementAPIKeyUsageDB(apiKeyId, 0, 0);
                }

                logRequestDB({
                    apiKeyId,
                    ipAddress,
                    userAgent,
                    providerId,
                    model: currentModel,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    statusCode: 200,
                    fallbackOccurred,
                    fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
                    fallbackReason,
                    latencyMs: Date.now() - startTime
                });

                return response;
            } catch (err) {
                lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!fallbackReason) {
                    fallbackReason = err instanceof Error ? err.message : String(err);
                }

                if (i < candidates.length - 1) {
                    continue;
                }

                const errorStatusCode = ExtractStatusCode(err as ErrorWithStatus) ?? 500;
                logRequestDB({
                    apiKeyId,
                    ipAddress,
                    userAgent,
                    providerId,
                    model: currentModel,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    statusCode: errorStatusCode,
                    fallbackOccurred,
                    fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
                    fallbackReason,
                    latencyMs: Date.now() - startTime
                });

                throw err;
            }
        }

        if (lastError) throw lastError;
        throw new Error(`Failed to generate image for model '${model}'`);
    }
}
