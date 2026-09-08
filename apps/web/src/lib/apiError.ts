export class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export async function responseError(response: Response): Promise<ApiError> {
    let message = response.statusText;
    try {
        const body = (await response.json()) as { error?: { message?: string } | string };
        message = typeof body.error === "string" ? body.error : (body.error?.message ?? message);
    } catch {
        // Keep the HTTP status text when the server does not return the standard error envelope.
    }
    return new ApiError(response.status, message);
}
