import type { Context } from "hono";
import { QuotaLogic } from "@/logic/quota.logic.js";
import { Ok } from "@/utils/response.js";

export class QuotaController {
    public static async getQuota(c: Context): Promise<Response> {
        const data = await QuotaLogic.getQuotaInfo();
        return Ok(c, data);
    }
}
