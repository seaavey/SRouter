import { Hono } from "hono";
import { QuotaController } from "@/controllers/quota.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const quotaRoute = new Hono();

quotaRoute.get("/quota", ApiKeyAuth, QuotaController.GetQuota);
quotaRoute.get("/qouta", ApiKeyAuth, QuotaController.GetQuota);
