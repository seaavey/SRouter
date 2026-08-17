import type { Context } from "hono";
import {
    createFallbackRuleDB,
    deleteFallbackRuleDB,
    getAllFallbackRulesDB,
    getFallbackRuleByIdDB,
    updateFallbackRuleDB
} from "@srouter/db";
import { FallbackRuleSchema, UpdateFallbackRuleSchema } from "@srouter/types";
import { err, ok } from "@/utils/response.js";

export class FallbacksController {
    public static getFallbacks(c: Context): Response {
        const fallbacks = getAllFallbackRulesDB();
        return ok(c, { fallbacks });
    }

    public static async createFallback(c: Context): Promise<Response> {
        try {
            const body = await c.req.json();
            const parseResult = FallbackRuleSchema.safeParse(body);
            if (!parseResult.success) {
                return err(c, parseResult.error.errors[0]?.message || "Validation failed", 400, {
                    type: "invalid_request_error"
                });
            }

            const rule = createFallbackRuleDB(parseResult.data);
            return ok(c, { fallback: rule }, 201);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return err(c, errorMessage, 500);
        }
    }

    public static async updateFallback(c: Context): Promise<Response> {
        try {
            const id = c.req.param("id");
            if (!id) {
                return err(c, "Missing rule ID parameter", 400, {
                    type: "invalid_request_error"
                });
            }

            const existing = getFallbackRuleByIdDB(id);
            if (!existing) {
                return err(c, `Fallback rule with ID "${id}" not found`, 404, {
                    type: "invalid_request_error"
                });
            }

            const body = await c.req.json();
            const parseResult = UpdateFallbackRuleSchema.safeParse(body);
            if (!parseResult.success) {
                return err(c, parseResult.error.errors[0]?.message || "Validation failed", 400, {
                    type: "invalid_request_error"
                });
            }

            const updated = updateFallbackRuleDB(id, parseResult.data);
            return ok(c, { fallback: updated });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return err(c, errorMessage, 500);
        }
    }

    public static deleteFallback(c: Context): Response {
        try {
            const id = c.req.param("id");
            if (!id) {
                return err(c, "Missing rule ID parameter", 400, {
                    type: "invalid_request_error"
                });
            }

            const existing = getFallbackRuleByIdDB(id);
            if (!existing) {
                return err(c, `Fallback rule with ID "${id}" not found`, 404, {
                    type: "invalid_request_error"
                });
            }

            deleteFallbackRuleDB(id);
            return ok(c, { message: `Fallback rule "${id}" deleted successfully` });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return err(c, errorMessage, 500);
        }
    }
}
