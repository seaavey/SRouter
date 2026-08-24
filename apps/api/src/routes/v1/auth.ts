import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";
import { adminAuth } from "@/middleware/adminAuth.js";

export const authRoute = new Hono();

export const handleOAuthCallback = AuthController.handleOAuthCallback;
export const handleAntigravityOAuthCallback = AuthController.handleAntigravityOAuthCallback;
export const handleClaudeOAuthCallback = AuthController.handleClaudeOAuthCallback;
export const handleQoderOAuthCallback = AuthController.handleQoderOAuthCallback;

authRoute.get("/auth/openai/login", adminAuth, AuthController.loginOpenAI);
authRoute.get("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/token", adminAuth, AuthController.importToken);

authRoute.get("/auth/antigravity/login", adminAuth, AuthController.loginAntigravity);
authRoute.get("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/token", adminAuth, AuthController.importAntigravityToken);

authRoute.post("/auth/commandcode/token", adminAuth, AuthController.importCommandCodeToken);

authRoute.post("/auth/anthropic/token", adminAuth, AuthController.importAnthropicToken);

authRoute.get("/auth/claude/login", adminAuth, AuthController.loginClaude);
authRoute.get("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/token", adminAuth, AuthController.importClaudeToken);

authRoute.post("/auth/gorouter/token", adminAuth, AuthController.importGoRouterToken);

authRoute.post("/auth/bluesminds/token", adminAuth, AuthController.importBluesMindsToken);

authRoute.post("/auth/seekai/token", adminAuth, AuthController.importSeekAIToken);

authRoute.post("/auth/tabitoken/token", adminAuth, AuthController.importTabiTokenToken);

authRoute.post("/auth/tokenrouter/token", adminAuth, AuthController.importTokenRouterToken);

authRoute.get("/auth/codebuddy/login", adminAuth, AuthController.loginCodeBuddy);
authRoute.get("/auth/codebuddy/poll", adminAuth, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/poll", adminAuth, AuthController.pollCodeBuddy);
authRoute.post("/auth/codebuddy/token", adminAuth, AuthController.importCodeBuddyToken);

authRoute.get("/auth/codebuddy-cn/login", adminAuth, AuthController.loginCodeBuddyCN);
authRoute.get("/auth/codebuddy-cn/poll", adminAuth, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/poll", adminAuth, AuthController.pollCodeBuddyCN);
authRoute.post("/auth/codebuddy-cn/token", adminAuth, AuthController.importCodeBuddyCNToken);

authRoute.get("/auth/qoder/login", adminAuth, AuthController.loginQoder);
authRoute.get("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.post("/auth/qoder/callback", AuthController.handleQoderOAuthCallback);
authRoute.get("/auth/qoder/poll", adminAuth, AuthController.pollQoder);
authRoute.post("/auth/qoder/poll", adminAuth, AuthController.pollQoder);
authRoute.post("/auth/qoder/token", adminAuth, AuthController.importQoderToken);
