import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";

export const AuthRouter = new Hono();
export const authRoute = AuthRouter;

export const CodexOAuthCallback = AuthController.OpenAI.Callback;
export const OpenAIAuthCallback = CodexOAuthCallback;
export const AntigravityOAuthCallback = AuthController.Antigravity.Callback;
export const ClaudeOAuthCallback = AuthController.Claude.Callback;
export const QoderOAuthCallback = AuthController.Qoder.Callback;

AuthRouter.get("/auth/openai/login", RequireAdmin, AuthController.OpenAI.OAuth);
AuthRouter.get("/auth/openai/callback", AuthController.OpenAI.Callback);
AuthRouter.post("/auth/openai/callback", AuthController.OpenAI.Callback);
AuthRouter.post("/auth/openai/token", RequireAdmin, AuthController.OpenAI.ImportToken);

AuthRouter.get("/auth/antigravity/login", RequireAdmin, AuthController.Antigravity.OAuth);
AuthRouter.get("/auth/antigravity/callback", AuthController.Antigravity.Callback);
AuthRouter.post("/auth/antigravity/callback", AuthController.Antigravity.Callback);
AuthRouter.post("/auth/antigravity/token", RequireAdmin, AuthController.Antigravity.ImportToken);

AuthRouter.post("/auth/commandcode/token", RequireAdmin, AuthController.CommandCode.ImportToken);

AuthRouter.post("/auth/anthropic/token", RequireAdmin, AuthController.Anthropic.ImportToken);

AuthRouter.get("/auth/claude/login", RequireAdmin, AuthController.Claude.OAuth);
AuthRouter.get("/auth/claude/callback", AuthController.Claude.Callback);
AuthRouter.post("/auth/claude/callback", AuthController.Claude.Callback);
AuthRouter.post("/auth/claude/token", RequireAdmin, AuthController.Claude.ImportToken);

AuthRouter.post("/auth/gorouter/token", RequireAdmin, AuthController.GoRouter.ImportToken);

AuthRouter.post("/auth/bluesminds/token", RequireAdmin, AuthController.BluesMinds.ImportToken);

AuthRouter.post("/auth/seekai/token", RequireAdmin, AuthController.SeekAI.ImportToken);

AuthRouter.post("/auth/tabitoken/token", RequireAdmin, AuthController.TabiToken.ImportToken);

AuthRouter.post("/auth/tokenrouter/token", RequireAdmin, AuthController.TokenRouter.ImportToken);

AuthRouter.get("/auth/codebuddy/login", RequireAdmin, AuthController.CodeBuddy.OAuth);
AuthRouter.get("/auth/codebuddy/poll", RequireAdmin, AuthController.CodeBuddy.Poll);
AuthRouter.post("/auth/codebuddy/poll", RequireAdmin, AuthController.CodeBuddy.Poll);
AuthRouter.post("/auth/codebuddy/token", RequireAdmin, AuthController.CodeBuddy.ImportToken);

AuthRouter.get("/auth/codebuddy-cn/login", RequireAdmin, AuthController.CodeBuddyCN.OAuth);
AuthRouter.get("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.CodeBuddyCN.Poll);
AuthRouter.post("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.CodeBuddyCN.Poll);
AuthRouter.post("/auth/codebuddy-cn/token", RequireAdmin, AuthController.CodeBuddyCN.ImportToken);

AuthRouter.get("/auth/qoder/login", RequireAdmin, AuthController.Qoder.OAuth);
AuthRouter.get("/auth/qoder/callback", AuthController.Qoder.Callback);
AuthRouter.post("/auth/qoder/callback", AuthController.Qoder.Callback);
AuthRouter.get("/auth/qoder/poll", RequireAdmin, AuthController.Qoder.Poll);
AuthRouter.post("/auth/qoder/poll", RequireAdmin, AuthController.Qoder.Poll);
AuthRouter.post("/auth/qoder/token", RequireAdmin, AuthController.Qoder.ImportToken);
