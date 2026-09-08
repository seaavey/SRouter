import { incrementAPIKeyUsageDB, logRequestDB } from "@srouter/db";
import { isImageGenerationSupported } from "@srouter/pricing";
import { CreateRequestAttemptBudget } from "@srouter/types";
import type {
    ImageGenerationRequest,
    ImageGenerationResponse,
    RequestAttemptBudget
} from "@srouter/types";
import { HTTPException } from "hono/http-exception";
import { registry } from "@/services/registry.js";
import { type AttemptTracker, RunCandidateAttempts } from "./fallbackRunner.js";
import { type ErrorWithStatus, ExtractStatusCode } from "./fallback.policy.js";

export class ImagesLogic {
    public static async generate(
        body: ImageGenerationRequest,
        startTime: number,
        apiKeyId?: string,
        ipAddress?: string,
        userAgent?: string,
        budget?: RequestAttemptBudget
    ): Promise<ImageGenerationResponse> {
        const requestBudget = budget ?? CreateRequestAttemptBudget();
        const model = body.model || "dall-e-3";
        const hasInputImage = Boolean(body.image || body.images);

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

        const tracker: AttemptTracker = {
            fallbackPath: [model],
            fallbackOccurred: false,
            fallbackReason: undefined,
            lastError: null
        };
        let lastAttemptModel = model;
        let lastAttemptProvider = model.split("/")[0] || "default";

        for await (const attempt of RunCandidateAttempts(model, tracker)) {
            const { currentModel, isFallbackAttempt, providerId } = attempt;
            lastAttemptModel = currentModel;
            lastAttemptProvider = providerId;
            const currentReq: ImageGenerationRequest = { ...body, model: currentModel };

            if (!isImageGenerationSupported(currentModel, hasInputImage)) {
                const reason = hasInputImage
                    ? `Model '${currentModel}' does not support image editing / image-to-image input.`
                    : `Model '${currentModel}' does not support image generation. Output modalities do not include 'image'.`;
                tracker.lastError = new HTTPException(400, { message: reason });
                if (!tracker.fallbackReason) tracker.fallbackReason = reason;
                continue;
            }

            try {
                const response = await registry.generateImage(currentReq, requestBudget);

                if (isFallbackAttempt) {
                    tracker.fallbackOccurred = true;
                    tracker.fallbackPath.push(currentModel);
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
                    fallbackOccurred: tracker.fallbackOccurred,
                    fallbackPath: tracker.fallbackOccurred
                        ? tracker.fallbackPath.join(" -> ")
                        : undefined,
                    fallbackReason: tracker.fallbackReason,
                    latencyMs: Date.now() - startTime
                });

                return response;
            } catch (err) {
                tracker.lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!tracker.fallbackReason) {
                    tracker.fallbackReason = err instanceof Error ? err.message : String(err);
                }
            }
        }

        if (tracker.lastError) {
            logRequestDB({
                apiKeyId,
                ipAddress,
                userAgent,
                providerId: lastAttemptProvider,
                model: lastAttemptModel,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                statusCode: ExtractStatusCode(tracker.lastError) ?? 500,
                fallbackOccurred: tracker.fallbackOccurred,
                fallbackPath: tracker.fallbackOccurred
                    ? tracker.fallbackPath.join(" -> ")
                    : undefined,
                fallbackReason: tracker.fallbackReason,
                latencyMs: Date.now() - startTime
            });
            throw tracker.lastError;
        }
        throw new Error(`Failed to generate image for model '${model}'`);
    }
}
