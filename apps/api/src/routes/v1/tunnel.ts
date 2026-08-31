import { Hono } from "hono";
import { TunnelController } from "@/controllers/tunnel.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";

export const TunnelRouter = new Hono();

// Admin-only: guards travel with the router so mount order can never leave
// tunnel mutations (subprocess spawn, installer, config writes) anonymous.
TunnelRouter.use("*", RequireAdmin);

TunnelRouter.get("/tunnel/status", TunnelController.GetStatus);
TunnelRouter.get("/tunnel/events", TunnelController.GetEvents);
TunnelRouter.post("/tunnel/start", TunnelController.StartTunnel);
TunnelRouter.post("/tunnel/stop", TunnelController.StopTunnel);
TunnelRouter.put("/tunnel/config", TunnelController.UpdateConfig);
TunnelRouter.post("/tunnel/install", TunnelController.Install);
TunnelRouter.get("/tunnel/install", TunnelController.GetInstallStatus);
