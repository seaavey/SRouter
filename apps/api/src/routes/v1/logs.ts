import { Hono } from "hono";
import { LogsController } from "@/controllers/logs.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const LogsRouter = new Hono();

LogsRouter.get("/logs", ApiKeyAuth, LogsController.ListLogs);
LogsRouter.get("/logs/stats", ApiKeyAuth, LogsController.GetStats);
LogsRouter.get("/logs/analytics", ApiKeyAuth, LogsController.GetAnalytics);
