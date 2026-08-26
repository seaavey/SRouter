import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { AuthRouter } from "@/routes/v1/auth.js";
import { AuthController } from "@/controllers/auth.controller.js";
import { adminRoute } from "@/routes/v1/admin.js";
import { chatRoute } from "@/routes/v1/chat.js";
import { keysRoute } from "@/routes/v1/keys.js";
import { logsRoute } from "@/routes/v1/logs.js";
import { messagesRoute } from "@/routes/v1/messages.js";
import { modelsRoute } from "@/routes/v1/models.js";
import { providersRoute } from "@/routes/v1/providers.js";
import { quotaRoute } from "@/routes/v1/quota.js";
import { settingsRoute } from "@/routes/v1/settings.js";
import { tunnelRoute } from "@/routes/v1/tunnel.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { startTokenRefreshSweeper } from "@/services/tokenRefresh.js";
import { resolveWebDistPath } from "@/services/webDist.js";
import { warmModelRegistry } from "@/services/registry.js";
import { bootstrapAdminAccountFromEnv } from "@/services/adminAuth.js";
import { autostartTunnelIfEnabled } from "@/services/cloudflareTunnel.js";
import { adminAuthStore } from "@srouter/db";

import { HTTPException } from "hono/http-exception";
import { API_VERSION } from "@srouter/constants";

const app = new Hono();

// Security Headers & Version Middleware
app.use("/*", async (c, next) => {
    await next();
    c.header("X-Powered-By", "Seaavey");
    c.header("X-Version", API_VERSION);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// Enable CORS with sensible defaults
app.use(
    "/*",
    cors({
        origin: (origin) => {
            // Allow requests with no origin (mobile apps, curl, server-to-server)
            if (!origin) return "*";
            // Allow localhost/loopback development origins
            if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
                return origin;
            }
            // For public origins, return origin without wildcard when credentials are needed,
            // or return origin if explicitly running as API gateway
            return origin;
        },
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key", "anthropic-version"],
        exposeHeaders: ["Content-Length", "X-Request-Id", "X-Version"],
        credentials: true
    })
);

// Bootstrap the admin account only when SROUTER_ADMIN_PASSWORD is set.
// Otherwise first-run setup happens through the dashboard.
bootstrapAdminAccountFromEnv(adminAuthStore);

// Re-launch the Cloudflare Tunnel if it was left running when the server last stopped.
autostartTunnelIfEnabled();

const apiInfo = () => ({
    name: "SRouter API",
    status: "ok",
    version: API_VERSION,
    documentation: "Multi-Provider OpenAI & Anthropic Compatible LLM Gateway"
});

// Shared error handler: renders the OpenAI-style error envelope for both servers.
const errorHandler = (label: string) => (err: Error, c: Context) => {
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

    if (err instanceof SyntaxError && err.message.includes("JSON")) {
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

    console.error(`🔥 ${label} Exception:`, err);
    return c.json(
        {
            error: {
                message: err.message || "Internal Server Error",
                type: "internal_error"
            }
        },
        500
    );
};

app.onError(errorHandler("API Route"));

// Health check endpoint
app.get("/health", (c) => {
    return c.json({ status: "ok" });
});

// Base /v1 endpoint for baseURL discovery
app.get("/v1", (c) => {
    return c.json(apiInfo());
});

// Mount OpenAI & Anthropic v1 API routes
app.route("/v1", modelsRoute);
app.route("/v1", adminRoute);
app.route("/v1", chatRoute);
app.route("/v1", messagesRoute);
app.route("/v1", providersRoute);
app.route("/v1", keysRoute);
app.route("/v1", logsRoute);
app.route("/v1", AuthRouter);
app.route("/v1", quotaRoute);
app.route("/v1", settingsRoute);

// Cloudflare Tunnel management (admin-only; status readable via API key too)
app.route("/v1", tunnelRoute);
app.use("/v1/tunnel/start", RequireAdmin);
app.use("/v1/tunnel/stop", RequireAdmin);
app.use("/v1/tunnel/config", RequireAdmin);
app.use("/v1/tunnel/install", RequireAdmin);

// Mount /v1/v1 compatibility routes for SDKs that append /v1 to a baseURL containing /v1
app.route("/v1/v1", messagesRoute);
app.route("/v1/v1", chatRoute);
app.route("/v1/v1", modelsRoute);

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
        return c.json(apiInfo());
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
oauthApp.onError(errorHandler("OAuth API Route"));
oauthApp.get("/auth/callback", (c) => AuthController.OpenAI.Callback(c));
oauthApp.post("/auth/callback", (c) => AuthController.OpenAI.Callback(c));
oauthApp.get("/auth/antigravity/callback", (c) => AuthController.Antigravity.Callback(c));
oauthApp.post("/auth/antigravity/callback", (c) => AuthController.Antigravity.Callback(c));
oauthApp.get("/auth/claude/callback", (c) => AuthController.Claude.Callback(c));
oauthApp.post("/auth/claude/callback", (c) => AuthController.Claude.Callback(c));
oauthApp.get("/auth/qoder/callback", (c) => AuthController.Qoder.Callback(c));
oauthApp.post("/auth/qoder/callback", (c) => AuthController.Qoder.Callback(c));
oauthApp.get("/auth/perch/callback", (c) => AuthController.Perch.Callback(c));
oauthApp.post("/auth/perch/callback", (c) => AuthController.Perch.Callback(c));
oauthApp.route("/v1", messagesRoute);
oauthApp.route("/v1", chatRoute);
oauthApp.route("/v1", modelsRoute);

const oauthPort = Number(process.env.OAUTH_PORT) || 1455;
const oauthHost = process.env.OAUTH_HOST || "127.0.0.1";

try {
    serve(
        {
            fetch: oauthApp.fetch,
            port: oauthPort,
            hostname: oauthHost
        },
        (info) => {
            console.log(
                `🔑 OAuth Callback Server running at http://${info.address}:${info.port}/auth/callback & /auth/antigravity/callback & /auth/claude/callback`
            );
        }
    );
} catch (err) {
    console.warn(`Could not start OAuth server on port ${oauthPort}:`, err);
}

// Start background OAuth token refresh sweeper
startTokenRefreshSweeper();

export default app;
