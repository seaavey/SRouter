import type { Context } from "hono";
import { getAllAPIKeysDB, createAPIKeyDB, deleteAPIKeyDB } from "@srouter/db";
import { err, ok } from "@/utils/response.js";

export class KeysController {
    public static listKeys(c: Context): Response {
        const keys = getAllAPIKeysDB();
        return ok(c, {
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
            return err(c, "Key name is required", 400, { type: "invalid_request_error" });
        }

        try {
            const created = createAPIKeyDB({
                name: body.name.trim(),
                rateLimit: body.rateLimit ? Number(body.rateLimit) : 0,
                quotaLimit: body.quotaLimit ? Number(body.quotaLimit) : 0
            });
            return ok(c, created, 201);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create API key";
            return err(c, message, 500);
        }
    }

    public static deleteKey(c: Context): Response {
        const id = c.req.param("id");
        if (!id) {
            return err(c, "Key ID is required", 400, { type: "invalid_request_error" });
        }

        const deleted = deleteAPIKeyDB(id);
        if (!deleted) {
            return err(c, `Key '${id}' not found`, 404, { type: "invalid_request_error" });
        }

        return ok(c, { message: "API Key revoked and deleted successfully" });
    }
}
