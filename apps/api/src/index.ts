import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
    authRoute,
    handleAntigravityOAuthCallback,
    handleClaudeOAuthCallback,
    handleOAuthCallback,
    handleQoderOAuthCallback
} from "@/routes/v1/auth.js";
import { adminRoute } from "@/routes/v1/admin.js";
import { chatRoute } from "@/routes/v1/chat.js";
import { keysRoute } from "@/routes/v1/keys.js";
import { logsRoute } from "@/routes/v1/logs.js";
import { messagesRoute } from "@/routes/v1/messages.js";
import { modelsRoute } from "@/routes/v1/models.js";
import { providersRoute } from "@/routes/v1/providers.js";
import { quotaRoute } from "@/routes/v1/quota.js";
import { settingsRoute } from "@/routes/v1/settings.js";
import { startTokenRefreshSweeper } from "@/services/tokenRefresh.js";
import { resolveWebDistPath } from "@/services/webDist.js";
import { warmModelRegistry } from "@/services/registry.js";

import { HTTPException } from "hono/http-exception";

const app = new Hono();

// Global Error Handler
app.onError((err, c) => {
    if (err instanceof HTTPException) {
        return c.json(
            {
                error: {
                    message: err.message || "Invalid request",
                    type: "invalid_request_error",
                    code: err.status === 400 ? "invalid_request" : undefined
                }
            },
            err.status
        );
    }

    if (err instanceof SyntaxError && "message" in err && (err as Error).message.includes("JSON")) {
        return c.json(
            {
                error: {
                    message: "Malformed JSON in request body",
                    type: "invalid_request_error",
                    code: "invalid_json"
                }
            },
            400
        );
    }

    console.error("🔥 API Route Exception:", err);
    return c.json(
        {
            error: {
                message: err.message || "Internal Server Error",
                type: "internal_error"
            }
        },
        500
    );
});

// Health check endpoint
app.get("/health", (c) => {
    return c.json({ status: "ok" });
});

// Mount OpenAI & Anthropic v1 API routes
app.route("/v1", modelsRoute);
app.route("/v1", adminRoute);
app.route("/v1", chatRoute);
app.route("/v1", messagesRoute);
app.route("/v1", providersRoute);
app.route("/v1", keysRoute);
app.route("/v1", logsRoute);
app.route("/v1", authRoute);
app.route("/v1", quotaRoute);
app.route("/v1", settingsRoute);

// Also mount root-level /messages for Anthropic clients sending to base URL directly
app.route("/", messagesRoute);

// Serve Web Dashboard in production if built dist exists
const webDistPath = resolveWebDistPath();
const hasWebDist =
    fs.existsSync(webDistPath) && fs.existsSync(path.join(webDistPath, "index.html"));

if (hasWebDist) {
    const relWebDist = path.relative(process.cwd(), webDistPath) || ".";
    app.use("/*", serveStatic({ root: relWebDist }));
    app.get("*", serveStatic({ path: path.join(relWebDist, "index.html") }));
} else {
    // API Welcome / Health info when web dist is not present
    app.get("/", (c) => {
        return c.json({
            name: "SRouter API",
            status: "ok",
            version: "0.1.1",
            documentation: "Multi-Provider OpenAI & Anthropic Compatible LLM Gateway"
        });
    });
}

const port = Number(process.env.PORT) || 3000;

serve(
    {
        fetch: app.fetch,
        port
    },
    (info) => {
        console.log(`🚀 SRouter Server running at http://localhost:${info.port}`);
        if (hasWebDist) {
            console.log(`🌐 Web Dashboard & API live at http://localhost:${info.port}`);
        } else {
            console.log(
                `ℹ️ Web dist not found. Running in API-only mode at http://localhost:${info.port}`
            );
        }
        warmModelRegistry();
    }
);

// Secondary listener on Port 1455 for OAuth callbacks and local Anthropic proxy
const oauthApp = new Hono();
oauthApp.onError((err, c) => {
    if (err instanceof HTTPException) {
        return c.json(
            {
                error: {
                    message: err.message || "Invalid request",
                    type: "invalid_request_error",
                    code: err.status === 400 ? "invalid_request" : undefined
                }
            },
            err.status
        );
    }
    if (err instanceof SyntaxError && "message" in err && (err as Error).message.includes("JSON")) {
        return c.json(
            {
                error: {
                    message: "Malformed JSON in request body",
                    type: "invalid_request_error",
                    code: "invalid_json"
                }
            },
            400
        );
    }
    console.error("🔥 OAuth API Route Exception:", err);
    return c.json(
        {
            error: {
                message: err.message || "Internal Server Error",
                type: "internal_error"
            }
        },
        500
    );
});
oauthApp.get("/auth/callback", (c) => handleOAuthCallback(c));
oauthApp.post("/auth/callback", (c) => handleOAuthCallback(c));
oauthApp.get("/auth/antigravity/callback", (c) => handleAntigravityOAuthCallback(c));
oauthApp.post("/auth/antigravity/callback", (c) => handleAntigravityOAuthCallback(c));
oauthApp.get("/auth/claude/callback", (c) => handleClaudeOAuthCallback(c));
oauthApp.post("/auth/claude/callback", (c) => handleClaudeOAuthCallback(c));
oauthApp.get("/auth/qoder/callback", (c) => handleQoderOAuthCallback(c));
oauthApp.post("/auth/qoder/callback", (c) => handleQoderOAuthCallback(c));
oauthApp.route("/v1", messagesRoute);
oauthApp.route("/", messagesRoute);
oauthApp.route("/v1", chatRoute);
oauthApp.route("/v1", modelsRoute);

const oauthPort = Number(process.env.OAUTH_PORT) || 1455;

try {
    serve(
        {
            fetch: oauthApp.fetch,
            port: oauthPort
        },
        (info) => {
            console.log(
                `🔑 OAuth Callback Server running at http://localhost:${info.port}/auth/callback & /auth/antigravity/callback & /auth/claude/callback`
            );
        }
    );
} catch (err) {
    console.warn(`Could not start OAuth server on port ${oauthPort}:`, err);
}

// Start background OAuth token refresh sweeper
startTokenRefreshSweeper();

export default app;
