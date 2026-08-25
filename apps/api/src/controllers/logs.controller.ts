import type { Context } from "hono";
import { LogsLogic } from "@/logic/logs.logic.js";
import { Ok } from "@/utils/response.js";

export class LogsController {
    public static listLogs(c: Context): Response {
        const limitParam = c.req.query("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const logs = LogsLogic.getRecentLogs(limit);

        return Ok(c, {
            object: "list",
            data: logs
        });
    }

    public static getStats(c: Context): Response {
        const stats = LogsLogic.getUsageStats();
        return Ok(c, stats);
    }
}
