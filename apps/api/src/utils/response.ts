import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ErrorType = {
    INVALID_REQUEST: "invalid_request_error",
    AUTHENTICATION: "authentication_error",
    PERMISSION: "permission_error",
    RATE_LIMIT: "rate_limit_error",
    API_ERROR: "api_error"
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

const STATUS_TO_ERROR_TYPE: Record<number, ErrorType> = {
    400: ErrorType.INVALID_REQUEST,
    404: ErrorType.INVALID_REQUEST,
    409: ErrorType.INVALID_REQUEST,
    422: ErrorType.INVALID_REQUEST,
    401: ErrorType.AUTHENTICATION,
    403: ErrorType.PERMISSION,
    429: ErrorType.RATE_LIMIT
};

export function GetErrorTypeFromStatus(status: number): ErrorType {
    return STATUS_TO_ERROR_TYPE[status] ?? ErrorType.API_ERROR;
}

export interface ErrorResponseOptions {
    type?: ErrorType | string;
    code?: string;
    param?: string;
}

export interface OpenAIErrorPayload {
    error: {
        message: string;
        type: string;
        code?: string;
        param?: string;
    };
}

export function FormatErrorPayload(
    message: string,
    status: number = 500,
    options: ErrorResponseOptions = {}
): OpenAIErrorPayload {
    return {
        error: {
            message,
            type: options.type ?? GetErrorTypeFromStatus(status),
            ...(options.code ? { code: options.code } : {}),
            ...(options.param ? { param: options.param } : {})
        }
    };
}

export const formatErrorPayload = FormatErrorPayload;

export function Ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200): Response {
    return c.json(data, status);
}

export const ok = Ok;

export function Err(
    c: Context,
    message: string,
    status: ContentfulStatusCode = 500,
    options: ErrorResponseOptions = {}
): Response {
    return c.json(FormatErrorPayload(message, status, options), status);
}

export interface AnthropicErrorPayload {
    type: "error";
    error: {
        type: string;
        message: string;
    };
}

export function FormatAnthropicErrorPayload(
    message: string,
    status: number = 500,
    type?: string
): AnthropicErrorPayload {
    return {
        type: "error",
        error: {
            type: type ?? GetErrorTypeFromStatus(status),
            message
        }
    };
}

export const err = Err;

export function AnthropicErr(
    c: Context,
    message: string,
    status: ContentfulStatusCode = 500,
    type?: string
): Response {
    return c.json(FormatAnthropicErrorPayload(message, status, type), status);
}
