import type { Context } from "hono";
import { LogsLogic } from "@/logic/logs.logic.js";
import { Ok } from "@/utils/response.js";

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


}
