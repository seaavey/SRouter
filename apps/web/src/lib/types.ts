import type { paths } from "@/generated/api";
import type { CreateProviderZod } from "@srouter/types";

// Response envelopes used by the API
export interface ListResponse<T> {
    object: "list";
    data: T[];
}

/**
 * The `window` query of `GET /v1/logs/analytics`, read straight from the
 * generated contract so the union can never drift from the document.
 */
export type AnalyticsWindow = NonNullable<
    NonNullable<paths["/v1/logs/analytics"]["get"]["parameters"]["query"]>["window"]
>;

export type { CreateAPIKeyInput } from "@/generated/api";
export type { CreateProviderZod };
