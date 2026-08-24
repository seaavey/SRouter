import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";

export const authRoute = new Hono();

export const handleOAuthCallback = AuthController.handleOAuthCallback;
export const handleAntigravityOAuthCallback = AuthController.handleAntigravityOAuthCallback;
export const handleClaudeOAuthCallback = AuthController.handleClaudeOAuthCallback;
export const handleQoderOAuthCallback = AuthController.handleQoderOAuthCallback;

authRoute.get("/auth/openai/login", RequireAdmin, AuthController.loginOpenAI);
authRoute.get("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/token", RequireAdmin, AuthController.importToken);

authRoute.get("/auth/antigravity/login", RequireAdmin, AuthController.loginAntigravity);
authRoute.get("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/token", RequireAdmin, AuthController.importAntigravityToken);

authRoute.post("/auth/commandcode/token", RequireAdmin, AuthController.importCommandCodeToken);

authRoute.post("/auth/anthropic/token", RequireAdmin, AuthController.importAnthropicToken);

authRoute.get("/auth/claude/login", RequireAdmin, AuthController.loginClaude);
authRoute.get("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/token", RequireAdmin, AuthController.importClaudeToken);

authRoute.post("/auth/gorouter/token", RequireAdmin, AuthController.importGoRouterToken);

authRoute.post("/auth/bluesminds/token", RequireAdmin, AuthController.importBluesMindsToken);

authRoute.post("/auth/seekai/token", RequireAdmin, AuthController.importSeekAIToken);

authRoute.post("/auth/tabitoken/token", RequireAdmin, AuthController.importTabiTokenToken);

authRoute.post("/auth/tokenrouter/token", RequireAdmin, AuthController.importTokenRouterToken);

authRoute.get("/auth/codebuddy/login", RequireAdmin, AuthController.loginCodeBuddy);
authRoute.get("/auth/codebuddy/poll", RequireAdmin, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/poll", RequireAdmin, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/token", RequireAdmin, AuthController.importCodeBuddyToken);

authRoute.get("/auth/codebuddy-cn/login", RequireAdmin, AuthController.loginCodeBuddyCN);
authRoute.get("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/poll", RequireAdmin, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/token", RequireAdmin, AuthController.importCodeBuddyCNToken);

authRoute.get("/auth/qoder/login", RequireAdmin, AuthController.loginQoder);
authRoute.get("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.post("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.get("/auth/qoder/poll", RequireAdmin, AuthController.pollQoder);
authRoute.post("/auth/qoder/poll", RequireAdmin, AuthController.pollQoder);
authRoute.post("/auth/qoder/token", RequireAdmin, AuthController.importQoderToken);
