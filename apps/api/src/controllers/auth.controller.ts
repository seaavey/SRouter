import type { Context } from "hono";
import { AuthLogic } from "@/logic/auth.logic.js";
import {
    anthropicAuthHandler,
    antigravityAuthHandler,
    bluesMindsAuthHandler,
    claudeAuthHandler,
    codeBuddyAuthHandler,
    commandCodeAuthHandler,
    goRouterAuthHandler,
    openaiCodexAuthHandler,
    qoderAuthHandler,
    seekAIAuthHandler,
    tabiTokenAuthHandler,
    tokenRouterAuthHandler,
    type AuthProviderHandler,
    type OAuthLoginParams,
    type TokenImportParams
} from "@/logic/auth.providers.js";
import { err, ok } from "@/utils/response.js";

export interface OAuthCallbackBody {
    code?: string;
    state?: string;
    callbackUrl?: string;
}

export interface TokenImportBody {
    accessToken: string;
    refreshToken?: string;
    baseUrl?: string;
    name?: string;
}

function renderOAuthSuccessHTML(providerName: string): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Otorisasi Berhasil</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px 40px; max-width: 380px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    .icon { font-size: 40px; margin-bottom: 12px; }
    h1 { font-size: 18px; margin: 0 0 8px; color: #10b981; font-weight: 700; }
    p { font-size: 13px; color: #a1a1aa; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✨</div>
    <h1>Otorisasi Berhasil!</h1>
    <p>Koneksi <strong>${providerName}</strong> telah berhasil ditambahkan ke SRouter. Jendela ini akan tertutup otomatis...</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "SROUTER_OAUTH_SUCCESS" }, "*");
      }
    } catch (e) {}
    setTimeout(function() {
      window.close();
    }, 1200);
  </script>
</body>
</html>`;
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
    });
}

// --- Generic engine (parameterized by an AuthProviderHandler) ---

/**
 * Initiate a PKCE OAuth login. Mirrors the original per-provider behavior:
 * - OpenAI login lets errors bubble (global handler → 500).
 * - Antigravity login catches errors and returns 400 invalid_request_error.
 * The `handleErrors` flag encodes that asymmetry.
 */
function loginFor(
    handler: AuthProviderHandler,
    initiate: (params: OAuthLoginParams) => ReturnType<typeof AuthLogic.initiateOAuthPKCE>,
    c: Context,
    handleErrors: boolean
): Response {
    const clientId = c.req.query("client_id") || undefined;
    const redirectUri = c.req.query("redirect_uri") || undefined;
    const prompt = c.req.query("prompt") || undefined;

    try {
        const result = initiate({ clientId, redirectUri, prompt });

        if (c.req.query("format") === "json") {
            return ok(c, result);
        }

        return c.redirect(result.authorizeUrl);
    } catch (error) {
        if (!handleErrors) throw error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        return err(c, errorMessage, 400, { type: "invalid_request_error" });
    }
}

/**
 * Handle an OAuth callback (GET from browser popup, or POST with a callbackUrl body).
 * Shared by the main app and the secondary OAuth listener (port 1455).
 */
async function handleOAuthCallbackFor(
    handler: AuthProviderHandler,
    processCallback: (code: string, state: string) => Promise<unknown>,
    c: Context
): Promise<Response> {
    let code = c.req.query("code") || undefined;
    let state = c.req.query("state") || undefined;

    if ((!code || !state) && c.req.method === "POST") {
        try {
            const body = await c.req.json<OAuthCallbackBody>();
            if (body.callbackUrl) {
                try {
                    const parsedUrl = new URL(body.callbackUrl);
                    code = code || parsedUrl.searchParams.get("code") || undefined;
                    state = state || parsedUrl.searchParams.get("state") || undefined;
                } catch {
                    // Ignore invalid URL string
                }
            }
            code = code || body.code;
            state = state || body.state;
        } catch {
            // Ignore JSON parse error
        }
    }

    if (!code || !state) {
        return err(c, "Missing required 'code' or 'state' parameters in OAuth callback", 400, {
            type: "invalid_request_error"
        });
    }

    try {
        const providerConfig = (await processCallback(code, state)) as {
            name: string;
        };

        if (c.req.method === "POST" || c.req.header("accept")?.includes("application/json")) {
            return ok(c, {
                success: true,
                message: handler.oauthSuccessMessage,
                provider: providerConfig
            });
        }

        return renderOAuthSuccessHTML(providerConfig.name);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return err(c, errorMessage, 500);
    }
}

/**
 * Import a provider token/API key from a JSON body.
 */
async function importTokenFor(
    handler: AuthProviderHandler,
    importLogic: (body: TokenImportParams) => unknown,
    c: Context
): Promise<Response> {
    let body: TokenImportBody;
    try {
        body = await c.req.json<TokenImportBody>();
    } catch {
        return err(c, "Invalid JSON body", 400, { type: "invalid_request_error" });
    }

    if (!body.accessToken) {
        return err(c, "Field 'accessToken' is required", 400, { type: "invalid_request_error" });
    }

    const providerConfig = importLogic(body);

    return ok(
        c,
        {
            success: true,
            message: handler.tokenImportMessage,
            provider: providerConfig
        },
        201
    );
}

// --- Public API (thin adapters, names preserved so routes/index.ts stay unchanged) ---

export class AuthController {
    // OpenAI OAuth
    public static loginOpenAI(c: Context): Response {
        return loginFor(openaiCodexAuthHandler, (p) => AuthLogic.initiateOAuthPKCE(p), c, false);
    }

    public static async handleOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            openaiCodexAuthHandler,
            (code, state) => AuthLogic.processOAuthCallback(code, state),
            c
        );
    }

    public static async importToken(c: Context): Promise<Response> {
        return importTokenFor(openaiCodexAuthHandler, (b) => AuthLogic.processTokenImport(b), c);
    }

    // Antigravity OAuth
    public static loginAntigravity(c: Context): Response {
        return loginFor(
            antigravityAuthHandler,
            (p) => AuthLogic.initiateProviderOAuth("antigravity", p),
            c,
            true
        );
    }

    public static async handleAntigravityOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            antigravityAuthHandler,
            (code, state) => AuthLogic.processProviderOAuthCallback("antigravity", code, state),
            c
        );
    }

    public static async importAntigravityToken(c: Context): Promise<Response> {
        return importTokenFor(
            antigravityAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("antigravity", b),
            c
        );
    }

    // CommandCode Provider (API key)
    public static async importCommandCodeToken(c: Context): Promise<Response> {
        return importTokenFor(
            commandCodeAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("commandcode", b),
            c
        );
    }

    // Anthropic Provider (API key)
    public static async importAnthropicToken(c: Context): Promise<Response> {
        return importTokenFor(
            anthropicAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("anthropic", b),
            c
        );
    }

    // Claude Code OAuth
    public static loginClaude(c: Context): Response {
        return loginFor(
            claudeAuthHandler,
            (p) => AuthLogic.initiateProviderOAuth("claude", p),
            c,
            false
        );
    }

    public static async handleClaudeOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            claudeAuthHandler,
            (code, state) => AuthLogic.processProviderOAuthCallback("claude", code, state),
            c
        );
    }

    public static async importClaudeToken(c: Context): Promise<Response> {
        return importTokenFor(
            claudeAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("claude", b),
            c
        );
    }

    // GoRouter Provider (API key)
    public static async importGoRouterToken(c: Context): Promise<Response> {
        return importTokenFor(
            goRouterAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("gorouter", b),
            c
        );
    }

    // BluesMinds Provider (API key)
    public static async importBluesMindsToken(c: Context): Promise<Response> {
        return importTokenFor(
            bluesMindsAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("bluesminds", b),
            c
        );
    }

    // SeekAI Provider (API key)
    public static async importSeekAIToken(c: Context): Promise<Response> {
        return importTokenFor(
            seekAIAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("seekai", b),
            c
        );
    }

    // TabiToken Provider (API key)
    public static async importTabiTokenToken(c: Context): Promise<Response> {
        return importTokenFor(
            tabiTokenAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("tabitoken", b),
            c
        );
    }

    // TokenRouter Provider (API key)
    public static async importTokenRouterToken(c: Context): Promise<Response> {
        return importTokenFor(
            tokenRouterAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("tokenrouter", b),
            c
        );
    }

    // CodeBuddy Provider (OAuth & Access Token)
    public static async loginCodeBuddy(c: Context): Promise<Response> {
        try {
            const result = await AuthLogic.initiateCodeBuddyOAuth();
            const format = c.req.query("format");
            if (format === "json") {
                return ok(c, {
                    authorizeUrl: result.authorizeUrl,
                    state: result.state
                });
            }
            return c.redirect(result.authorizeUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Internal Server Error";
            return err(c, `Failed to initiate CodeBuddy login: ${message}`, 500, {
                type: "api_error"
            });
        }
    }

    public static async pollCodeBuddy(c: Context): Promise<Response> {
        let state = c.req.query("state");
        if (!state) {
            try {
                const body = await c.req.json<{ state?: string }>();
                state = body?.state;
            } catch {}
        }

        if (!state) {
            return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
        }

        const result = await AuthLogic.pollCodeBuddyDeviceToken(state);
        return ok(c, result);
    }

    public static async importCodeBuddyToken(c: Context): Promise<Response> {
        return importTokenFor(
            codeBuddyAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("codebuddy", b),
            c
        );
    }

    // Qoder Provider (OAuth & PAT)
    public static loginQoder(c: Context): Response {
        return loginFor(
            qoderAuthHandler,
            (p) => AuthLogic.initiateProviderOAuth("qoder", p),
            c,
            true
        );
    }

    public static async handleQoderOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            qoderAuthHandler,
            (code, state) => AuthLogic.processProviderOAuthCallback("qoder", code, state),
            c
        );
    }

    public static async importQoderToken(c: Context): Promise<Response> {
        return importTokenFor(
            qoderAuthHandler,
            (b) => AuthLogic.processProviderTokenImport("qoder", b),
            c
        );
    }

    public static async pollQoder(c: Context): Promise<Response> {
        let state = c.req.query("state");
        if (!state) {
            try {
                const body = await c.req.json<{ state?: string }>();
                state = body?.state;
            } catch {}
        }

        if (!state) {
            return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
        }

        const result = await AuthLogic.pollQoderDeviceToken(state);
        return ok(c, result);
    }
}
