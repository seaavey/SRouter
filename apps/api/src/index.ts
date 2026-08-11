import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { authRoute, handleAntigravityOAuthCallback, handleOAuthCallback } from "@/routes/v1/auth.js";
import { chatRoute } from "@/routes/v1/chat.js";
import { logsRoute } from "@/routes/v1/logs.js";
import { modelsRoute } from "@/routes/v1/models.js";
import { providersRoute } from "@/routes/v1/providers.js";
import { quotaRoute } from "@/routes/v1/quota.js";
import { startTokenRefreshSweeper } from "@/services/tokenRefresh.js";

const app = new Hono();

// Global Error Handler
app.onError((err, c) => {
    console.error("🔥 API Route Exception:", err);
    return c.json(
        {
            error: {
                message: err.message || "Internal Server Error",
                type: "internal_error",
            },
        },
        500,
    );
});

// Health check endpoint
app.get("/", (c) => {
    return c.json({
        name: "SRouter API",
        status: "ok",
        version: "1.0.0",
        documentation: "Multi-Provider OpenAI & Anthropic Compatible LLM Gateway",
    });
});

app.get("/health", (c) => {
    return c.json({ status: "ok" });
});


// Mount OpenAI & Anthropic v1 API routes
app.route("/v1", modelsRoute);
app.route("/v1", chatRoute);
app.route("/v1", providersRoute);
app.route("/v1", logsRoute);
app.route("/v1", authRoute);
app.route("/v1", quotaRoute);

const port = Number(process.env.PORT) || 3000;

serve(
    {
        fetch: app.fetch,
        port,
    },
    (info) => {
        console.log(`🚀 SRouter API Server running at http://localhost:${info.port}`);
    },
);

// Secondary listener on Port 1455 for OAuth callbacks
const oauthApp = new Hono();
oauthApp.get("/auth/callback", (c) => handleOAuthCallback(c));
oauthApp.post("/auth/callback", (c) => handleOAuthCallback(c));
oauthApp.get("/auth/antigravity/callback", (c) => handleAntigravityOAuthCallback(c));
oauthApp.post("/auth/antigravity/callback", (c) => handleAntigravityOAuthCallback(c));

const oauthPort = Number(process.env.OAUTH_PORT) || 1455;

try {
    serve(
        {
            fetch: oauthApp.fetch,
            port: oauthPort,
        },
        (info) => {
            console.log(`🔑 OAuth Callback Server running at http://localhost:${info.port}/auth/callback & /auth/antigravity/callback`);
        },
    );
} catch (err) {
    console.warn(`Could not start OAuth server on port ${oauthPort}:`, err);
}

// Start background OAuth token refresh sweeper
startTokenRefreshSweeper();

export default app;
