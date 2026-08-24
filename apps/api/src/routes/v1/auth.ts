import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";

export const authRoute = new Hono();

export const handleOAuthCallback = AuthController.OpenAI.Callback;
export const handleAntigravityOAuthCallback = AuthController.Antigravity.Callback;
export const handleClaudeOAuthCallback = AuthController.Claude.Callback;
export const handleQoderOAuthCallback = AuthController.Qoder.Callback;

authRoute.get("/auth/openai/login", RequireAdmin, AuthController.OpenAI.OAuth);
authRoute.get("/auth/openai/callback", AuthController.OpenAI.Callback);
authRoute.post("/auth/openai/callback", AuthController.OpenAI.Callback);
authRoute.post("/auth/openai/token", RequireAdmin, AuthController.OpenAI.ImportToken);

authRoute.get("/auth/antigravity/login", RequireAdmin, AuthController.Antigravity.OAuth);
authRoute.get("/auth/antigravity/callback", AuthController.Antigravity.Callback);
authRoute.post("/auth/antigravity/callback", AuthController.Antigravity.Callback);
authRoute.post("/auth/antigravity/token", RequireAdmin, AuthController.Antigravity.ImportToken);

authRoute.post("/auth/commandcode/token", RequireAdmin, AuthController.CommandCode.ImportToken);

authRoute.post("/auth/anthropic/token", RequireAdmin, AuthController.Anthropic.ImportToken);

authRoute.get("/auth/claude/login", RequireAdmin, AuthController.Claude.OAuth);
authRoute.get("/auth/claude/callback", AuthController.Claude.Callback);
authRoute.post("/auth/claude/callback", AuthController.Claude.Callback);
authRoute.post("/auth/claude/token", RequireAdmin, AuthController.Claude.ImportToken);

authRoute.post("/auth/gorouter/token", RequireAdmin, AuthController.GoRouter.ImportToken);

authRoute.post("/auth/bluesminds/token", RequireAdmin, AuthController.BluesMinds.ImportToken);

authRoute.post("/auth/seekai/token", RequireAdmin, AuthController.SeekAI.ImportToken);

authRoute.post("/auth/tabitoken/token", RequireAdmin, AuthController.TabiToken.ImportToken);

authRoute.post("/auth/tokenrouter/token", RequireAdmin, AuthController.TokenRouter.ImportToken);

authRoute.get("/auth/codebuddy/login", RequireAdmin, AuthController.CodeBuddy.OAuth);
authRoute.get("/auth/codebuddy/poll", RequireAdmin, AuthController.CodeBuddy.Poll);
authRoute.post("/auth/codebuddy/poll", RequireAdmin, AuthController.CodeBuddy.Poll);
authRoute.post("/auth/codebuddy/token", RequireAdmin, AuthController.CodeBuddy.ImportToken);

authRoute.get("/auth/codebuddy-cn/login", RequireAdmin, AuthController.CodeBuddyCN.OAuth);
authRoute.get("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.CodeBuddyCN.Poll);
authRoute.post("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.CodeBuddyCN.Poll);
authRoute.post("/auth/codebuddy-cn/token", RequireAdmin, AuthController.CodeBuddyCN.ImportToken);

authRoute.get("/auth/qoder/login", RequireAdmin, AuthController.Qoder.OAuth);
authRoute.get("/auth/qoder/callback", AuthController.Qoder.Callback);
authRoute.post("/auth/qoder/callback", AuthController.Qoder.Callback);
authRoute.get("/auth/qoder/poll", RequireAdmin, AuthController.Qoder.Poll);
authRoute.post("/auth/qoder/poll", RequireAdmin, AuthController.Qoder.Poll);
authRoute.post("/auth/qoder/token", RequireAdmin, AuthController.Qoder.ImportToken);
