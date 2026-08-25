import type { Context } from "hono";
import type { CreateProviderPayload } from "@/logic/providers.logic.js";
import { ProvidersLogic } from "@/logic/providers.logic.js";
import { deleteProviderDB } from "@srouter/db";
import {
    AddCustomModelSchema,
    CreateProviderSchema,
    VerifyProviderSchema
} from "@srouter/types";
import { loadSavedProvidersFromDB, registry } from "@/services/registry.js";
import { Err, Ok } from "@/utils/response.js";

export class ProvidersController {
    public static ListProviders(c: Context): Response {
        return Ok(c, {
            object: "list",
            data: ProvidersLogic.listProviders()
        });
    }

    public static GetCatalog(c: Context): Response {
        return Ok(c, ProvidersLogic.getCatalog());
    }

    public static async GetProvider(c: Context): Promise<Response> {
        const ProviderId = c.req.param("providerId");
        if (!ProviderId) return Err(c, "Provider ID is required", 400);

        const Provider = await ProvidersLogic.getProviderById(ProviderId);
        if (!Provider) {
            return Err(c, `Provider '${ProviderId}' not found`, 404);
        }
        return Ok(c, Provider);
    }

    public static async AddProvider(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = CreateProviderSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid provider payload", 400);
        }

        try {
            const Created = ProvidersLogic.addProvider(Parsed.data as CreateProviderPayload);
            return Ok(c, Created);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Invalid provider payload", 400);
        }
    }

    public static DeleteProvider(c: Context): Response {
        const Id = c.req.param("id");
        if (!Id) return Err(c, "Connection ID is required", 400);
        if (!deleteProviderDB(Id)) {
            return Err(c, `Connection '${Id}' not found`, 404);
        }

        registry.unregisterProvider(Id);
        loadSavedProvidersFromDB();
        return Ok(c, { message: "Connection deleted" });
    }

    public static async VerifyProvider(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = VerifyProviderSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid verification payload", 400);
        }

        const Result = await ProvidersLogic.verifyConnection(Parsed.data);
        return Ok(c, Result);
    }

    public static async AddCustomModel(c: Context): Promise<Response> {
        const ProviderId = c.req.param("providerId");
        if (!ProviderId) return Err(c, "Provider ID is required", 400);

        const RawBody = await c.req.json().catch(() => null);
        const Parsed = AddCustomModelSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid model payload", 400);
        }

        try {
            const Model = ProvidersLogic.addCustomModel(ProviderId, Parsed.data.modelId);
            return Ok(c, Model, 201);
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Invalid model payload", 400);
        }
    }

    public static DeleteCustomModel(c: Context): Response {
        const ProviderId = c.req.param("providerId");
        const ModelId = c.req.param("modelId");
        if (!ProviderId || !ModelId) {
            return Err(c, "Provider ID and model ID are required", 400);
        }

        try {
            ProvidersLogic.deleteCustomModel(ProviderId, decodeURIComponent(ModelId));
            return Ok(c, { message: "Custom model deleted" });
        } catch (error) {
            return Err(c, error instanceof Error ? error.message : "Failed to delete model", 404);
        }
    }
}
