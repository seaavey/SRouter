import type { Context } from "hono";
import { AuthLogic } from "@/logic/auth.logic.js";
import { AuthHandlers } from "@/services/authHandlers.js";
import type {
    AuthProviderHandler,
    OAuthLoginParams,
    TokenImportParams
} from "@srouter/types";
import { err, ok } from "@/utils/response.js";

async function extractState(c: Context): Promise<string | undefined> {
    let state = c.req.query("state");
    if (!state && c.req.method === "POST") {
        try {
            const body = await c.req.json<{ state?: string }>();
            state = body?.state;
        } catch {}
    }
    return state || undefined;
}

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

async function handleOAuthCallbackFor(
    handler: AuthProviderHandler,
    processCallback: (code: string, state: string) => Promise<unknown>,
    c: Context
): Promise<Response> {
    let code = c.req.query("code") || undefined;
    let state = c.req.query("state") || undefined;

    if ((!code || !state) && c.req.method === "POST") {
        try {
            const body = await c.req.json<{ code?: string; state?: string; callbackUrl?: string }>();
            if (body.callbackUrl) {
                try {
                    const parsedUrl = new URL(body.callbackUrl);
                    code = code || parsedUrl.searchParams.get("code") || undefined;
                    state = state || parsedUrl.searchParams.get("state") || undefined;
                } catch {}
            }
            code = code || body.code;
            state = state || body.state;
        } catch {}
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

        return ok(c, {
            success: true,
            message: handler.oauthSuccessMessage,
            provider: providerConfig
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return err(c, errorMessage, 500);
    }
}

async function importTokenFor(
    handler: AuthProviderHandler,
    importLogic: (body: TokenImportParams) => unknown,
    c: Context
): Promise<Response> {
    let body: { accessToken?: string; refreshToken?: string; baseUrl?: string; name?: string };
    try {
        body = await c.req.json();
    } catch {
        return err(c, "Invalid JSON body", 400, { type: "invalid_request_error" });
    }

    if (!body?.accessToken) {
        return err(c, "Field 'accessToken' is required", 400, { type: "invalid_request_error" });
    }

    const providerConfig = importLogic(body as TokenImportParams);

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

export class AuthController {
    public static loginOpenAI(c: Context): Response {
        return loginFor(AuthHandlers.OpenAI, (p) => AuthLogic.initiateOAuthPKCE(p), c, false);
    }

    public static async handleOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            AuthHandlers.OpenAI,
            (code, state) => AuthLogic.processOAuthCallback(code, state),
            c
        );
    }

    public static async importToken(c: Context): Promise<Response> {
        return importTokenFor(AuthHandlers.OpenAI, (b) => AuthLogic.processTokenImport(b), c);
    }

    public static loginAntigravity(c: Context): Response {
        return loginFor(
            AuthHandlers.Antigravity,
            (p) => AuthLogic.initiateProviderOAuth("antigravity", p),
            c,
            true
        );
    }

    public static async handleAntigravityOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            AuthHandlers.Antigravity,
            (code, state) => AuthLogic.processProviderOAuthCallback("antigravity", code, state),
            c
        );
    }

    public static async importAntigravityToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.Antigravity,
            (b) => AuthLogic.processProviderTokenImport("antigravity", b),
            c
        );
    }

    public static async importCommandCodeToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.CommandCode,
            (b) => AuthLogic.processProviderTokenImport("commandcode", b),
            c
        );
    }

    public static async importAnthropicToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.Anthropic,
            (b) => AuthLogic.processProviderTokenImport("anthropic", b),
            c
        );
    }

    public static loginClaude(c: Context): Response {
        return loginFor(
            AuthHandlers.Claude,
            (p) => AuthLogic.initiateProviderOAuth("claude", p),
            c,
            false
        );
    }

    public static async handleClaudeOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            AuthHandlers.Claude,
            (code, state) => AuthLogic.processProviderOAuthCallback("claude", code, state),
            c
        );
    }

    public static async importClaudeToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.Claude,
            (b) => AuthLogic.processProviderTokenImport("claude", b),
            c
        );
    }

    public static async importGoRouterToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.GoRouter,
            (b) => AuthLogic.processProviderTokenImport("gorouter", b),
            c
        );
    }

    public static async importBluesMindsToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.BluesMinds,
            (b) => AuthLogic.processProviderTokenImport("bluesminds", b),
            c
        );
    }

    public static async importSeekAIToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.SeekAI,
            (b) => AuthLogic.processProviderTokenImport("seekai", b),
            c
        );
    }

    public static async importTabiTokenToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.TabiToken,
            (b) => AuthLogic.processProviderTokenImport("tabitoken", b),
            c
        );
    }

    public static async importTokenRouterToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.TokenRouter,
            (b) => AuthLogic.processProviderTokenImport("tokenrouter", b),
            c
        );
    }

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
        const state = await extractState(c);
        if (!state) {
            return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
        }

        const result = await AuthLogic.pollCodeBuddyDeviceToken(state);
        return ok(c, result);
    }

    public static async importCodeBuddyToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.CodeBuddy,
            (b) => AuthLogic.processProviderTokenImport("codebuddy", b),
            c
        );
    }

    public static async loginCodeBuddyCN(c: Context): Promise<Response> {
        try {
            const result = await AuthLogic.initiateCodeBuddyCNOAuth();
            if (c.req.query("format") === "json") {
                return ok(c, { authorizeUrl: result.authorizeUrl, state: result.state });
            }
            return c.redirect(result.authorizeUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Internal Server Error";
            return err(c, `Failed to initiate CodeBuddy CN login: ${message}`, 500, {
                type: "api_error"
            });
        }
    }

    public static async pollCodeBuddyCN(c: Context): Promise<Response> {
        const state = await extractState(c);
        if (!state) {
            return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
        }

        return ok(c, await AuthLogic.pollCodeBuddyCNDeviceToken(state));
    }

    public static async importCodeBuddyCNToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.CodeBuddyCN,
            (b) => AuthLogic.processProviderTokenImport("codebuddy-cn", b),
            c
        );
    }

    public static loginQoder(c: Context): Response {
        return loginFor(
            AuthHandlers.Qoder,
            (p) => AuthLogic.initiateProviderOAuth("qoder", p),
            c,
            true
        );
    }

    public static async handleQoderOAuthCallback(c: Context): Promise<Response> {
        return handleOAuthCallbackFor(
            AuthHandlers.Qoder,
            (code, state) => AuthLogic.processProviderOAuthCallback("qoder", code, state),
            c
        );
    }

    public static async importQoderToken(c: Context): Promise<Response> {
        return importTokenFor(
            AuthHandlers.Qoder,
            (b) => AuthLogic.processProviderTokenImport("qoder", b),
            c
        );
    }

    public static async pollQoder(c: Context): Promise<Response> {
        const state = await extractState(c);
        if (!state) {
            return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
        }

        const result = await AuthLogic.pollQoderDeviceToken(state);
        return ok(c, result);
    }
}
