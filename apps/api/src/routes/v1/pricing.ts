import { Hono } from "hono";
import { PricingController } from "@/controllers/pricing.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const PricingRouter = new Hono();

PricingRouter.get("/pricing/models", ApiKeyAuth, PricingController.ListPricingModels);
