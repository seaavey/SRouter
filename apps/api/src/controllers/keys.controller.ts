import type { Context } from "hono";
import { getAllAPIKeysDB, createAPIKeyDB, deleteAPIKeyDB } from "@srouter/db";
import { CreateAPIKeySchema } from "@srouter/types";
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
                quotaLimit: parsed.data.quotaLimit ?? 0
            });
            return Ok(c, created, 201);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Failed to create API key", 500);
        }
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
