import type { Context } from "hono";
import {
    createFallbackRuleDB,
    deleteFallbackRuleDB,
    getAllFallbackRulesDB,
    getFallbackRuleByIdDB,
    updateFallbackRuleDB
} from "@srouter/db";
import { FallbackRuleSchema, UpdateFallbackRuleSchema } from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class FallbacksController {
    public static GetFallbacks(c: Context): Response {
        return Ok(c, { fallbacks: getAllFallbackRulesDB() });
    }

    public static async CreateFallback(c: Context): Promise<Response> {
        const rawBody = await c.req.json().catch(() => null);
        const parsed = FallbackRuleSchema.safeParse(rawBody);
        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Validation failed", 400);
        }

        try {
            return Ok(c, { fallback: createFallbackRuleDB(parsed.data) }, 201);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : String(error), 500);
        }
    }

    public static async UpdateFallback(c: Context): Promise<Response> {
        const id = c.req.param("id");
        if (!id) return Err(c, "Missing rule ID parameter", 400);
        if (!getFallbackRuleByIdDB(id)) {
            return Err(c, `Fallback rule with ID "${id}" not found`, 404);
        }

        const rawBody = await c.req.json().catch(() => null);
        const parsed = UpdateFallbackRuleSchema.safeParse(rawBody);
        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Validation failed", 400);
        }

        try {
            return Ok(c, { fallback: updateFallbackRuleDB(id, parsed.data) });
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : String(error), 500);
        }
    }

    public static DeleteFallback(c: Context): Response {
        const id = c.req.param("id");
        if (!id) return Err(c, "Missing rule ID parameter", 400);
        if (!getFallbackRuleByIdDB(id)) {
            return Err(c, `Fallback rule with ID "${id}" not found`, 404);
        }

        try {
            deleteFallbackRuleDB(id);
            return Ok(c, { message: `Fallback rule "${id}" deleted successfully` });
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : String(error), 500);
        }
    }

    public static getFallbacks = FallbacksController.GetFallbacks;
    public static createFallback = FallbacksController.CreateFallback;
    public static updateFallback = FallbacksController.UpdateFallback;
    public static deleteFallback = FallbacksController.DeleteFallback;
}
