import type { Context, MiddlewareHandler } from "hono";
import type { APIKeyZod } from "@srouter/types";
import { Err } from "@/utils/response.js";

function NormalizeModelId(model: string): string {
    return model.replace(/^srouter\//, "").toLowerCase();
}

export function IsModelAllowed(
    allowedModels: string[] | null | undefined,
    model: string
): boolean {
    if (!allowedModels || allowedModels.length === 0) return true;

    const Requested = NormalizeModelId(model);
    return allowedModels.some((allowed) => {
        const Allowed = NormalizeModelId(allowed);
        if (Allowed === Requested || allowed.toLowerCase() === model.toLowerCase()) {
            return true;
        }

        // Support matching model ID with or without provider prefix
        // e.g. allowed: "gpt-4o" matches "openai/gpt-4o"
        // or allowed: "openai/gpt-4o" matches "gpt-4o"
        const allowedParts = Allowed.split("/");
        const requestedParts = Requested.split("/");
        const bareAllowed = allowedParts[allowedParts.length - 1];
        const bareRequested = requestedParts[requestedParts.length - 1];

        return bareAllowed === bareRequested;
    });
}

export function GetApiKeyRow(c: Context): APIKeyZod | undefined {
    return c.get("apiKeyRow") as APIKeyZod | undefined;
}

export function EnforceModelAccess(): MiddlewareHandler {
    return async (c, next) => {
        const ApiKeyRow = GetApiKeyRow(c);
        const AllowedModels = ApiKeyRow?.allowed_models;

        if (AllowedModels && AllowedModels.length > 0) {
            const Body = c.req.valid("json" as never) as { model?: string } | undefined;
            const Model = Body?.model;

            if (Model && !IsModelAllowed(AllowedModels, Model)) {
                return Err(c, `Model '${Model}' is not allowed for this API key`, 403, {
                    code: "model_not_allowed"
                });
            }
        }

        return await next();
    };
}
