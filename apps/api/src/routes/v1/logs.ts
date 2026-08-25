import { Hono } from "hono";
import { LogsController } from "@/controllers/logs.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const logsRoute = new Hono();

logsRoute.get("/logs", ApiKeyAuth, LogsController.ListLogs);
logsRoute.get("/logs/stats", ApiKeyAuth, LogsController.GetStats);
