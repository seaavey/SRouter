import type { Context } from "hono";
import { getAllAPIKeysDB, createAPIKeyDB, deleteAPIKeyDB } from "@srouter/db";
import { Err, Ok } from "@/utils/response.js";

export class KeysController {
    public static listKeys(c: Context): Response {
        const keys = getAllAPIKeysDB();
        return Ok(c, {
            object: "list",
            data: keys
        });
    }

    public static async createKey(c: Context): Promise<Response> {
        const body = await c.req.json<{
            name: string;
            rateLimit?: number;
            quotaLimit?: number;
        }>();

        if (!body.name || typeof body.name !== "string") {
            return Err(c, "Key name is required", 400);
        }

        try {
            const created = createAPIKeyDB({
                name: body.name.trim(),
                rateLimit: body.rateLimit ? Number(body.rateLimit) : 0,
                quotaLimit: body.quotaLimit ? Number(body.quotaLimit) : 0
            });
            return Ok(c, created, 201);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create API key";
            return Err(c, message, 500);
        }
    }

    public static deleteKey(c: Context): Response {
        const id = c.req.param("id");
        if (!id) {
            return Err(c, "Key ID is required", 400);
        }

        const deleted = deleteAPIKeyDB(id);
        if (!deleted) {
            return Err(c, `Key '${id}' not found`, 404);
        }

        return Ok(c, { message: "API Key revoked and deleted successfully" });
    }
}
