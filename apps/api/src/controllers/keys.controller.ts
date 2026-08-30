import type { Context } from "hono";
import {
    getAllAPIKeysDB,
    createAPIKeyDB,
    deleteAPIKeyDB,
    addCreditAPIKeyDB,
    updateAPIKeyDB
} from "@srouter/db";
import { CreateAPIKeySchema, AddCreditSchema, UpdateAPIKeySchema } from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class KeysController {
    public static ListKeys(c: Context): Response {
        return Ok(c, {
            object: "list",
            data: getAllAPIKeysDB()
        });
    }

    public static async CreateKey(c: Context): Promise<Response> {
        const rawBody = await c.req.json().catch(() => null);
        const parsed = CreateAPIKeySchema.safeParse(rawBody);
        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Invalid API key payload", 400);
        }

        try {
            const created = createAPIKeyDB({
                name: parsed.data.name.trim(),
                rateLimit: parsed.data.rateLimit ?? 0,
                quotaLimit: parsed.data.quotaLimit ?? 0,
                creditLimit: parsed.data.creditLimit ?? 0,
                allowed_models: parsed.data.allowed_models ?? null
            });
            return Ok(c, created, 201);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Failed to create API key", 500);
        }
    }

    public static async UpdateKey(c: Context): Promise<Response> {
        const id = c.req.param("id");
        if (!id) return Err(c, "Key ID is required", 400);

        const rawBody = await c.req.json().catch(() => null);
        const parsed = UpdateAPIKeySchema.safeParse(rawBody);
        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Invalid update payload", 400);
        }

        try {
            const updated = updateAPIKeyDB(id, parsed.data);
            if (!updated) {
                return Err(c, `Key '${id}' not found`, 404);
            }
            return Ok(c, updated);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Failed to update API key", 500);
        }
    }

    public static async AddCredit(c: Context): Promise<Response> {
        const id = c.req.param("id");
        if (!id) return Err(c, "Key ID is required", 400);

        const rawBody = await c.req.json().catch(() => null);
        const parsed = AddCreditSchema.safeParse(rawBody);
        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Invalid credit payload", 400);
        }

        const updated = addCreditAPIKeyDB(id, parsed.data.amount);
        if (!updated) {
            return Err(c, `Key '${id}' not found`, 404);
        }

        return Ok(c, updated);
    }

    public static DeleteKey(c: Context): Response {
        const id = c.req.param("id");
        if (!id) return Err(c, "Key ID is required", 400);
        if (!deleteAPIKeyDB(id)) {
            return Err(c, `Key '${id}' not found`, 404);
        }

        return Ok(c, { message: "API Key revoked and deleted successfully" });
    }
}
