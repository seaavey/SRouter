import type { Context } from "hono";
import { QuotaLogic } from "@/logic/quota.logic.js";
import { Ok } from "@/utils/response.js";

export class QuotaController {
    public static async GetQuota(c: Context): Promise<Response> {
        const force = c.req.query("refresh") === "true" || c.req.query("force") === "true";
        return Ok(c, await QuotaLogic.getQuotaInfo(force));
    }
}
