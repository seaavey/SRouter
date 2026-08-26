import type { Context } from "hono";
import type { CreateProviderPayload } from "@/logic/providers.logic.js";
import { ProvidersLogic } from "@/logic/providers.logic.js";
import { deleteProviderDB } from "@srouter/db";
import { CreateProviderSchema, VerifyProviderSchema } from "@srouter/types";
import { loadSavedProvidersFromDB, registry } from "@/services/registry.js";
import { Err, Ok } from "@/utils/response.js";

export class ProvidersController {
    public static ListProviders(c: Context): Response {
        return Ok(c, {
            object: "list",
            data: ProvidersLogic.ListProviders()
        });
    }

    public static GetCatalog(c: Context): Response {
        return Ok(c, ProvidersLogic.GetCatalog());
    }

    public static async GetProvider(c: Context): Promise<Response> {
        const ProviderId = c.req.param("providerId");
        if (!ProviderId) return Err(c, "Provider ID is required", 400);

        const Provider = await ProvidersLogic.GetProviderById(ProviderId);
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
            const Created = ProvidersLogic.AddProvider(Parsed.data as CreateProviderPayload);
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

        const Result = await ProvidersLogic.VerifyConnection(Parsed.data);
        return Ok(c, Result);
    }
}
