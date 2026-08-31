import type { ZodSchema } from "zod";
import type { MiddlewareHandler } from "hono";
import { MAX_BODY_BYTES } from "@/middleware/BodyLimit.js";

export function ValidateJson<T extends ZodSchema>(Schema: T): MiddlewareHandler {
    return async (c, next) => {
        let Body: unknown;
        try {
            const Raw = await c.req.text();
            if (Raw.length > MAX_BODY_BYTES) {
                return c.json(
                    {
                        error: {
                            message: "Request body too large",
                            type: "invalid_request_error",
                            code: "request_too_large"
                        }
                    },
                    413
                );
            }
            if (!Raw || !Raw.trim()) {
                return c.json(
                    {
                        error: {
                            message: "Request body cannot be empty. Valid JSON is required.",
                            type: "invalid_request_error",
                            code: "invalid_json"
                        }
                    },
                    400
                );
            }
            Body = JSON.parse(Raw);
        } catch {
            return c.json(
                {
                    error: {
                        message: "Malformed JSON in request body. Please verify JSON syntax.",
                        type: "invalid_request_error",
                        code: "invalid_json"
                    }
                },
                400
            );
        }

        const Result = Schema.safeParse(Body);
        if (!Result.success) {
            const FirstIssue = Result.error.issues[0];
            const Param = FirstIssue?.path.join(".") || undefined;

            return c.json(
                {
                    error: {
                        message: FirstIssue?.message || "Invalid request body",
                        type: "invalid_request_error",
                        param: Param,
                        code: FirstIssue?.code
                    }
                },
                400
            );
        }

        c.req.addValidatedData("json", Result.data);
        await next();
    };
}
