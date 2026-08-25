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
        const fallbacks = getAllFallbackRulesDB();
        return Ok(c, { fallbacks });
    }

    public static async CreateFallback(c: Context): Promise<Response> {
        try {
            const body = await c.req.json();
            const parseResult = FallbackRuleSchema.safeParse(body);
            if (!parseResult.success) {
                return Err(c, parseResult.error.errors[0]?.message || "Validation failed", 400);
            }

            const rule = createFallbackRuleDB(parseResult.data);
            return Ok(c, { fallback: rule }, 201);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 500);
        }
    }

    public static async UpdateFallback(c: Context): Promise<Response> {
        try {
            const id = c.req.param("id");
            if (!id) {
                return Err(c, "Missing rule ID parameter", 400);
            }

            const existing = getFallbackRuleByIdDB(id);
            if (!existing) {
                return Err(c, `Fallback rule with ID "${id}" not found`, 404);
            }

            const body = await c.req.json();
            const parseResult = UpdateFallbackRuleSchema.safeParse(body);
            if (!parseResult.success) {
                return Err(c, parseResult.error.errors[0]?.message || "Validation failed", 400);
            }

            const updated = updateFallbackRuleDB(id, parseResult.data);
            return Ok(c, { fallback: updated });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 500);
        }
    }

    public static DeleteFallback(c: Context): Response {
        try {
            const id = c.req.param("id");
            if (!id) {
                return Err(c, "Missing rule ID parameter", 400);
            }

            const existing = getFallbackRuleByIdDB(id);
            if (!existing) {
                return Err(c, `Fallback rule with ID "${id}" not found`, 404);
            }

            deleteFallbackRuleDB(id);
            return Ok(c, { message: `Fallback rule "${id}" deleted successfully` });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return Err(c, errorMessage, 500);
        }
    }

    public static getFallbacks = FallbacksController.GetFallbacks;
    public static createFallback = FallbacksController.CreateFallback;
    public static updateFallback = FallbacksController.UpdateFallback;
    public static deleteFallback = FallbacksController.DeleteFallback;
}
