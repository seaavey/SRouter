import { Hono } from "hono";
import { LogsController } from "@/controllers/logs.controller.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const logsRoute = new Hono();
logsRoute.use("/*", apiKeyAuth);

// GET /v1/logs - Get recent request logs
logsRoute.get("/logs", LogsController.listLogs);

// GET /v1/logs/stats - Get token usage summary & request count
logsRoute.get("/logs/stats", LogsController.getStats);
