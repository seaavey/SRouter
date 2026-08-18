import type { ZodSchema } from "zod";
import type { MiddlewareHandler } from "hono";

/**
 * Custom Hono Zod JSON validation middleware
 * Ensures all validation errors and malformed JSON errors return OpenAI-standard error JSON format
 */
export function validateJson<T extends ZodSchema>(schema: T): MiddlewareHandler {
    return async (c, next) => {
        let body: unknown;
        try {
            const raw = await c.req.text();
            if (!raw || !raw.trim()) {
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
            body = JSON.parse(raw);
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

        const result = schema.safeParse(body);
        if (!result.success) {
            const firstIssue = result.error.issues[0];
            const param = firstIssue?.path.join(".") || undefined;

            return c.json(
                {
                    error: {
                        message: firstIssue?.message || "Invalid request body",
                        type: "invalid_request_error",
                        param,
                        code: firstIssue?.code
                    }
                },
                400
            );
        }

        c.req.addValidatedData("json", result.data);
        await next();
    };
}
