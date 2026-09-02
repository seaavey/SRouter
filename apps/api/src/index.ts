import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { AuthRouter } from "@/routes/v1/auth.js";
import { AuthController } from "@/controllers/auth.controller.js";
import { adminRoute } from "@/routes/v1/admin.js";
import { ChatRouter } from "@/routes/v1/chat.js";
import { KeysRouter } from "@/routes/v1/keys.js";
import { LogsRouter } from "@/routes/v1/logs.js";
import { MessagesRouter } from "@/routes/v1/messages.js";
import { ModelsRouter } from "@/routes/v1/models.js";
import { ProvidersRouter } from "@/routes/v1/providers.js";
import { QuotaRouter } from "@/routes/v1/quota.js";
import { SettingsRouter } from "@/routes/v1/settings.js";
import { TunnelRouter } from "@/routes/v1/tunnel.js";
import { CreateCorsMiddleware, ParseAllowedOrigins } from "@/middleware/Cors.js";
import { CreateCsrfOriginGuard } from "@/middleware/CsrfOrigin.js";
import { CreateBodyLimitMiddleware } from "@/middleware/BodyLimit.js";
import { startTokenRefreshSweeper } from "@/services/tokenRefresh.js";
import { resolveWebDistPath } from "@/services/webDist.js";
import { warmModelRegistry, startProviderRegistry } from "@/services/registry.js";
import { bootstrapAdminAccountFromEnv } from "@/services/adminAuth.js";
import { autostartTunnelIfEnabled } from "@/services/cloudflareTunnel.js";
import { GetPublicUrlBase } from "@/utils/callbackUrl.js";
import { adminAuthStore, initDatabase, isPostgres } from "@srouter/db";

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

// CORS: loopback origins always pass; public origins require SROUTER_CORS_ORIGINS.
const CorsAllowlist = ParseAllowedOrigins();
app.use("/*", CreateCorsMiddleware(CorsAllowlist));

// CSRF defense for cookie-authenticated mutations (no-op for API-key traffic).
app.use("/v1/*", CreateCsrfOriginGuard(CorsAllowlist));

// Reject oversized bodies before they are buffered into memory.
app.use("/v1/*", CreateBodyLimitMiddleware());

// Bootstrap the admin account only when SROUTER_ADMIN_PASSWORD is set.
// Otherwise first-run setup happens through the dashboard.
// (Moved into boot() — must run after PG schema init.)

// Re-launch the Cloudflare Tunnel if it was left running when the server last stopped.
// (Moved into boot() — queries DB, must run after PG schema init.)

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
app.route("/v1", ModelsRouter);
app.route("/v1", adminRoute);
app.route("/v1", ChatRouter);
app.route("/v1", MessagesRouter);
app.route("/v1", ProvidersRouter);
app.route("/v1", KeysRouter);
app.route("/v1", LogsRouter);
app.route("/v1", AuthRouter);
app.route("/v1", QuotaRouter);
app.route("/v1", SettingsRouter);

// Cloudflare Tunnel management (admin-only; guard lives inside TunnelRouter)
app.route("/v1", TunnelRouter);

// Mount /v1/v1 compatibility routes for SDKs that append /v1 to a baseURL containing /v1
app.route("/v1/v1", MessagesRouter);
app.route("/v1/v1", ChatRouter);
app.route("/v1/v1", ModelsRouter);

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
oauthApp.route("/v1", MessagesRouter);
oauthApp.route("/v1", ChatRouter);
oauthApp.route("/v1", ModelsRouter);

const oauthPort = Number(process.env.OAUTH_PORT) || 1455;
const oauthHost = process.env.OAUTH_HOST || "127.0.0.1";

async function boot(): Promise<void> {
    // Postgres schema init is async — await it before serving any request
    // so the first query never hits a missing table. SQLite is already
    // initialized synchronously at module import.
    if (isPostgres()) {
        await initDatabase();
    }

    // Bootstrap admin account & tunnel autostart: query DB, so must run
    // after schema init (especially for Postgres).
    void bootstrapAdminAccountFromEnv(adminAuthStore);
    void autostartTunnelIfEnabled();

    // Seed default provider rows + load saved providers (must run after DB schema init).
    await startProviderRegistry();

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

    // Secondary listener on Port 1455 for OAuth callbacks and local Anthropic proxy.
    // When SROUTER_PUBLIC_URL is set (Heroku/public deploys) the OAuth callback
    // routes already live on the main server, so binding an extra port would
    // fail on platforms that expose only $PORT.
    if (!GetPublicUrlBase()) {
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
    }

    // Start background OAuth token refresh sweeper
    startTokenRefreshSweeper();
}

void boot();

export default app;
