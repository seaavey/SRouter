import type { MiddlewareHandler } from "hono";
import { Err } from "@/utils/response.js";

/** Max accepted request body in bytes (25 MB). Large enough for base64 image payloads. */
export const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Rejects oversized bodies from the Content-Length header before the body is
 * buffered. ValidateJson enforces the same cap on the raw text for chunked
 * requests that omit Content-Length.
 */
export function CreateBodyLimitMiddleware(MaxBytes: number = MAX_BODY_BYTES): MiddlewareHandler {
    return async (c, next) => {
        const LengthHeader = c.req.header("content-length");
        if (LengthHeader) {
            const Length = Number(LengthHeader);
            if (Number.isFinite(Length) && Length > MaxBytes) {
                return Err(c, "Request body too large", 413, { code: "request_too_large" });
            }
        }
        return next();
    };
}
