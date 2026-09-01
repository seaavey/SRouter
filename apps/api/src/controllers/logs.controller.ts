import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { LogsLogic } from "@/logic/logs.logic.js";
import { Ok } from "@/utils/response.js";
import { AnalyticsQuerySchema } from "@srouter/types";

export class LogsController {
    public static ListLogs(c: Context): Response {
        const limit = Number(c.req.query("limit")) || 50;
        return Ok(c, {
            object: "list",
            data: LogsLogic.getRecentLogs(limit)
        });
    }

    public static GetStats(c: Context): Response {
        return Ok(c, LogsLogic.getUsageStats());
    }

    public static GetAnalytics(c: Context): Response {
        const Query = c.req.query("window") || "24h";
        const Result = AnalyticsQuerySchema.safeParse({ window: Query });
        if (!Result.success) {
            throw new HTTPException(400, { message: "Invalid window parameter" });
        }
        return Ok(c, LogsLogic.getAnalytics(Result.data.window));
    }
}
