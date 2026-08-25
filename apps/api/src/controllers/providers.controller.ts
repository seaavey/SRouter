import type { Context } from "hono";
import type { CreateProviderPayload } from "@/logic/providers.logic.js";
import { ProvidersLogic } from "@/logic/providers.logic.js";
import { deleteProviderDB } from "@srouter/db";
import { CreateProviderSchema } from "@srouter/types";
import { loadSavedProvidersFromDB, registry } from "@/services/registry.js";
import { Err, Ok } from "@/utils/response.js";

export class ProvidersController {
    public static ListProviders(c: Context): Response {
        const catalog = ProvidersLogic.listProviders();
        return Ok(c, {
            object: "list",
            data: catalog
        });
    }

    public static GetCatalog(c: Context): Response {
        const summary = ProvidersLogic.getCatalog();
        return Ok(c, summary);
    }

    public static async GetProvider(c: Context): Promise<Response> {
        const providerId = c.req.param("providerId");
        if (!providerId) return Err(c, "Provider ID is required", 400);
        const provider = await ProvidersLogic.getProviderById(providerId);
        if (!provider) {
            return Err(c, `Provider '${providerId}' not found`, 404);
        }
        return Ok(c, provider);
    }

    public static async AddProvider(c: Context): Promise<Response> {
        const rawBody = await c.req.json().catch(() => null);
        const parsed = CreateProviderSchema.safeParse(rawBody);

        if (!parsed.success) {
            return Err(c, parsed.error.issues[0]?.message || "Invalid provider payload", 400);
        }

        try {
            const created = ProvidersLogic.addProvider(parsed.data as CreateProviderPayload);
            return Ok(c, created);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Invalid provider payload";
            return Err(c, message, 400);
        }
    }

    public static DeleteProvider(c: Context): Response {
        const id = c.req.param("id");
        if (!id) return Err(c, "Connection ID is required", 400);
        const deleted = deleteProviderDB(id);
        if (!deleted) {
            return Err(c, `Connection '${id}' not found`, 404);
        }
        registry.unregisterProvider(id);
        loadSavedProvidersFromDB();
        return Ok(c, { message: "Connection deleted" });
    }

    public static async VerifyProvider(c: Context): Promise<Response> {
        const body = await c.req.json<{
            protocol: "openai" | "anthropic" | "gemini" | "custom";
            baseUrl?: string;
            apiKey?: string;
        }>();

        const result = await ProvidersLogic.verifyConnection(body);
        return Ok(c, result);
    }

    public static async AddCustomModel(c: Context): Promise<Response> {
        const providerId = c.req.param("providerId");
        if (!providerId) return Err(c, "Provider ID is required", 400);

        const body = await c.req.json<{ modelId?: string }>();
        try {
            const model = ProvidersLogic.addCustomModel(providerId, body.modelId ?? "");
            return Ok(c, model, 201);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Invalid model payload";
            return Err(c, message, 400);
        }
    }

    public static DeleteCustomModel(c: Context): Response {
        const providerId = c.req.param("providerId");
        const modelId = c.req.param("modelId");
        if (!providerId || !modelId)
            return Err(c, "Provider ID and model ID are required", 400);

        try {
            ProvidersLogic.deleteCustomModel(providerId, decodeURIComponent(modelId));
            return Ok(c, { message: "Custom model deleted" });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete model";
            return Err(c, message, 404);
        }
    }

    public static listProviders = ProvidersController.ListProviders;
    public static getCatalog = ProvidersController.GetCatalog;
    public static getProvider = ProvidersController.GetProvider;
    public static addProvider = ProvidersController.AddProvider;
    public static deleteProvider = ProvidersController.DeleteProvider;
    public static verifyProvider = ProvidersController.VerifyProvider;
    public static addCustomModel = ProvidersController.AddCustomModel;
    public static deleteCustomModel = ProvidersController.DeleteCustomModel;
}
