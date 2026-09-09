import type { Context } from "hono";
import { PricingLogic } from "@/logic/pricing.logic.js";
import { Ok } from "@/utils/response.js";

const PRICING_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export class PricingController {
    public static ListPricingModels(c: Context): Response {
        const refreshParam = c.req.query("refresh") || c.req.query("force");
        const cacheControlReq = c.req.header("cache-control");
        const explicitRefresh = refreshParam === "true" || refreshParam === "1";
        const revalidate =
            cacheControlReq?.includes("no-cache") || cacheControlReq?.includes("no-store");

        const forceRefresh = explicitRefresh || revalidate;
        const responseData = PricingLogic.getPricingList(forceRefresh);

        c.header("Cache-Control", PRICING_CACHE_CONTROL);
        return Ok(c, responseData);
    }
}
