import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";
import { requireAdmin } from "@/middleware/adminAuth.js";

export const authRoute = new Hono();

export const handleOAuthCallback = AuthController.handleOAuthCallback;
export const handleAntigravityOAuthCallback = AuthController.handleAntigravityOAuthCallback;
export const handleClaudeOAuthCallback = AuthController.handleClaudeOAuthCallback;
export const handleQoderOAuthCallback = AuthController.handleQoderOAuthCallback;

authRoute.get("/auth/openai/login", requireAdmin, AuthController.loginOpenAI);
authRoute.get("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/token", requireAdmin, AuthController.importToken);

authRoute.get("/auth/antigravity/login", requireAdmin, AuthController.loginAntigravity);
authRoute.get("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/token", requireAdmin, AuthController.importAntigravityToken);

authRoute.post("/auth/commandcode/token", requireAdmin, AuthController.importCommandCodeToken);

authRoute.post("/auth/anthropic/token", requireAdmin, AuthController.importAnthropicToken);

authRoute.get("/auth/claude/login", requireAdmin, AuthController.loginClaude);
authRoute.get("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/token", requireAdmin, AuthController.importClaudeToken);

authRoute.post("/auth/gorouter/token", requireAdmin, AuthController.importGoRouterToken);

authRoute.post("/auth/bluesminds/token", requireAdmin, AuthController.importBluesMindsToken);

authRoute.post("/auth/seekai/token", requireAdmin, AuthController.importSeekAIToken);

authRoute.post("/auth/tabitoken/token", requireAdmin, AuthController.importTabiTokenToken);

authRoute.post("/auth/tokenrouter/token", requireAdmin, AuthController.importTokenRouterToken);

authRoute.get("/auth/codebuddy/login", requireAdmin, AuthController.loginCodeBuddy);
authRoute.get("/auth/codebuddy/poll", requireAdmin, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/poll", requireAdmin, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/token", requireAdmin, AuthController.importCodeBuddyToken);

authRoute.get("/auth/codebuddy-cn/login", requireAdmin, AuthController.loginCodeBuddyCN);
authRoute.get("/auth/codebuddy-cn/poll", requireAdmin, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/poll", requireAdmin, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/token", requireAdmin, AuthController.importCodeBuddyCNToken);

authRoute.get("/auth/qoder/login", requireAdmin, AuthController.loginQoder);
authRoute.get("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.post("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.get("/auth/qoder/poll", requireAdmin, AuthController.pollQoder);
authRoute.post("/auth/qoder/poll", requireAdmin, AuthController.pollQoder);
authRoute.post("/auth/qoder/token", requireAdmin, AuthController.importQoderToken);
