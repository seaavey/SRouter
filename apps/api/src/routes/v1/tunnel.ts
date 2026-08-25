import { Hono } from "hono";
import { TunnelController } from "@/controllers/tunnel.controller.js";

export const tunnelRoute = new Hono();

tunnelRoute.get("/tunnel/status", TunnelController.GetStatus);
tunnelRoute.get("/tunnel/events", TunnelController.GetEvents);
tunnelRoute.post("/tunnel/start", TunnelController.StartTunnel);
tunnelRoute.post("/tunnel/stop", TunnelController.StopTunnel);
tunnelRoute.put("/tunnel/config", TunnelController.UpdateConfig);
tunnelRoute.post("/tunnel/install", TunnelController.Install);
tunnelRoute.get("/tunnel/install", TunnelController.GetInstallStatus);
