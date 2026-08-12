import type { Context } from "hono";
import type { CreateProviderPayload } from "@/logic/providers.logic.js";
import { ProvidersLogic } from "@/logic/providers.logic.js";
import { deleteProviderDB, getProviderByIdDB } from "@srouter/db";
import { freebuffExecutor, loadSavedProvidersFromDB } from "@/services/registry.js";
import { ok } from "@/utils/response.js";

export class ProvidersController {
    public static listProviders(c: Context): Response {
        const catalog = ProvidersLogic.listProviders();
        return ok(c, {
            object: "list",
            data: catalog,
        });
    }

    public static getCatalog(c: Context): Response {
        const summary = ProvidersLogic.getCatalog();
        return ok(c, summary);
    }

    public static async getProvider(c: Context): Promise<Response> {
        const providerId = c.req.param("providerId") ?? "";
        const provider = await ProvidersLogic.getProviderById(providerId);
        if (!provider) {
            return c.json({ error: { message: `Provider '${providerId}' not found` } }, 404);
        }
        return ok(c, provider);
    }

    public static async addProvider(c: Context): Promise<Response> {
        const body = await c.req.json<CreateProviderPayload>();
        if (!body.name || !body.category || !body.protocol) {
            return c.json({ error: { message: "Name, category, and protocol are required" } }, 400);
        }
        const created = ProvidersLogic.addProvider(body);
        return ok(c, created);
    }

    public static async deleteProvider(c: Context): Promise<Response> {
        const id = c.req.param("id") ?? "";
        const saved = getProviderByIdDB(id);
        if (saved === null) {
            return c.json({ error: { message: `Connection '${id}' not found` } }, 404);
        }
        const existing = saved.providerId === "freebuff" || id.startsWith("freebuff_") || id.startsWith("freebuff-")
            ? freebuffExecutor.unregister(id)
            : Promise.resolve();
        await existing;
        const deleted = deleteProviderDB(id);
        if (!deleted) {
            return c.json({ error: { message: `Connection '${id}' not found` } }, 404);
        }
        loadSavedProvidersFromDB();
        return ok(c, { message: "Connection deleted" });
    }
}

