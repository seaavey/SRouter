import { Hono } from "hono";
import { AuthController } from "@/controllers/auth.controller.js";

export const authRoute = new Hono();

export const handleOAuthCallback = AuthController.handleOAuthCallback;
export const handleAntigravityOAuthCallback = AuthController.handleAntigravityOAuthCallback;
export const handleClaudeOAuthCallback = AuthController.handleClaudeOAuthCallback;
export const handleCommandCodeTokenImport = AuthController.importCommandCodeToken;

// --- OpenAI OAuth ---
// 1. GET /v1/auth/openai/login - Initiate OAuth PKCE Login Flow
authRoute.get("/auth/openai/login", AuthController.loginOpenAI);

// 2. GET & POST /v1/auth/openai/callback - OAuth Callback Receiver
authRoute.get("/auth/openai/callback", AuthController.handleOAuthCallback);
authRoute.post("/auth/openai/callback", AuthController.handleOAuthCallback);

// 3. POST /v1/auth/openai/token & POST /v1/auth/openai/import-token
authRoute.post("/auth/openai/token", AuthController.importToken);
authRoute.post("/auth/openai/import-token", AuthController.importToken);

// --- Antigravity OAuth ---
// 1. GET /v1/auth/antigravity/login - Initiate Antigravity OAuth PKCE Login Flow
authRoute.get("/auth/antigravity/login", AuthController.loginAntigravity);

// 2. GET & POST /v1/auth/antigravity/callback - Antigravity OAuth Callback Receiver
authRoute.get("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);
authRoute.post("/auth/antigravity/callback", AuthController.handleAntigravityOAuthCallback);

// 3. POST /v1/auth/antigravity/token & POST /v1/auth/antigravity/import-token
authRoute.post("/auth/antigravity/token", AuthController.importAntigravityToken);
authRoute.post("/auth/antigravity/import-token", AuthController.importAntigravityToken);

// --- CommandCode Provider (API key) ---
// 1. POST /v1/auth/commandcode/token & POST /v1/auth/commandcode/import-token
authRoute.post("/auth/commandcode/token", AuthController.importCommandCodeToken);
authRoute.post("/auth/commandcode/import-token", AuthController.importCommandCodeToken);

// --- Anthropic Provider (API key) ---
// 1. POST /v1/auth/anthropic/token & POST /v1/auth/anthropic/import-token
authRoute.post("/auth/anthropic/token", AuthController.importAnthropicToken);
authRoute.post("/auth/anthropic/import-token", AuthController.importAnthropicToken);

// --- Claude Code OAuth ---
// 1. GET /v1/auth/claude/login - Initiate Claude Code OAuth PKCE Login Flow
authRoute.get("/auth/claude/login", AuthController.loginClaude);

// 2. GET & POST /v1/auth/claude/callback - OAuth Callback Receiver
authRoute.get("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);
authRoute.post("/auth/claude/callback", AuthController.handleClaudeOAuthCallback);

// 3. POST /v1/auth/claude/token & POST /v1/auth/claude/import-token
authRoute.post("/auth/claude/token", AuthController.importClaudeToken);
authRoute.post("/auth/claude/import-token", AuthController.importClaudeToken);
