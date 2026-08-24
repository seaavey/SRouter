import type { Context } from "hono";
import { AuthLogic } from "@/logic/auth.logic.js";
import { AuthHandlers } from "@/services/authHandlers.js";
import type {
    AuthProviderHandler,
    OAuthCallbackBody,
    OAuthLoginParams,
    ProviderConfig,
    TokenImportBody,
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
    processCallback: (code: string, state: string) => Promise<ProviderConfig>,
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
        const providerConfig = await processCallback(code, state);

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
    importLogic: (body: TokenImportParams) => ProviderConfig,
    c: Context
): Promise<Response> {
    let body: TokenImportBody;
    try {
        body = await c.req.json<TokenImportBody>();
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

export const AuthController = {
    OpenAI: {
        OAuth: (c: Context): Response =>
            loginFor(AuthHandlers.OpenAI, (p) => AuthLogic.initiateOAuthPKCE(p), c, false),
        Callback: (c: Context): Promise<Response> =>
            handleOAuthCallbackFor(
                AuthHandlers.OpenAI,
                (code, state) => AuthLogic.processOAuthCallback(code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(AuthHandlers.OpenAI, (b) => AuthLogic.processTokenImport(b), c)
    },

    Antigravity: {
        OAuth: (c: Context): Response =>
            loginFor(
                AuthHandlers.Antigravity,
                (p) => AuthLogic.initiateProviderOAuth("antigravity", p),
                c,
                true
            ),
        Callback: (c: Context): Promise<Response> =>
            handleOAuthCallbackFor(
                AuthHandlers.Antigravity,
                (code, state) => AuthLogic.processProviderOAuthCallback("antigravity", code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.Antigravity,
                (b) => AuthLogic.processProviderTokenImport("antigravity", b),
                c
            )
    },

    CommandCode: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.CommandCode,
                (b) => AuthLogic.processProviderTokenImport("commandcode", b),
                c
            )
    },

    Anthropic: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.Anthropic,
                (b) => AuthLogic.processProviderTokenImport("anthropic", b),
                c
            )
    },

    Claude: {
        OAuth: (c: Context): Response =>
            loginFor(
                AuthHandlers.Claude,
                (p) => AuthLogic.initiateProviderOAuth("claude", p),
                c,
                false
            ),
        Callback: (c: Context): Promise<Response> =>
            handleOAuthCallbackFor(
                AuthHandlers.Claude,
                (code, state) => AuthLogic.processProviderOAuthCallback("claude", code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.Claude,
                (b) => AuthLogic.processProviderTokenImport("claude", b),
                c
            )
    },

    GoRouter: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.GoRouter,
                (b) => AuthLogic.processProviderTokenImport("gorouter", b),
                c
            )
    },

    BluesMinds: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.BluesMinds,
                (b) => AuthLogic.processProviderTokenImport("bluesminds", b),
                c
            )
    },

    SeekAI: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.SeekAI,
                (b) => AuthLogic.processProviderTokenImport("seekai", b),
                c
            )
    },

    TabiToken: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.TabiToken,
                (b) => AuthLogic.processProviderTokenImport("tabitoken", b),
                c
            )
    },

    TokenRouter: {
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.TokenRouter,
                (b) => AuthLogic.processProviderTokenImport("tokenrouter", b),
                c
            )
    },

    CodeBuddy: {
        OAuth: async (c: Context): Promise<Response> => {
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
        },
        Poll: async (c: Context): Promise<Response> => {
            const state = await extractState(c);
            if (!state) {
                return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
            }

            const result = await AuthLogic.pollCodeBuddyDeviceToken(state);
            return ok(c, result);
        },
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.CodeBuddy,
                (b) => AuthLogic.processProviderTokenImport("codebuddy", b),
                c
            )
    },

    CodeBuddyCN: {
        OAuth: async (c: Context): Promise<Response> => {
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
        },
        Poll: async (c: Context): Promise<Response> => {
            const state = await extractState(c);
            if (!state) {
                return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
            }

            return ok(c, await AuthLogic.pollCodeBuddyCNDeviceToken(state));
        },
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.CodeBuddyCN,
                (b) => AuthLogic.processProviderTokenImport("codebuddy-cn", b),
                c
            )
    },

    Qoder: {
        OAuth: (c: Context): Response =>
            loginFor(
                AuthHandlers.Qoder,
                (p) => AuthLogic.initiateProviderOAuth("qoder", p),
                c,
                true
            ),
        Callback: (c: Context): Promise<Response> =>
            handleOAuthCallbackFor(
                AuthHandlers.Qoder,
                (code, state) => AuthLogic.processProviderOAuthCallback("qoder", code, state),
                c
            ),
        Poll: async (c: Context): Promise<Response> => {
            const state = await extractState(c);
            if (!state) {
                return err(c, "Missing state parameter", 400, { type: "invalid_request_error" });
            }

            const result = await AuthLogic.pollQoderDeviceToken(state);
            return ok(c, result);
        },
        ImportToken: (c: Context): Promise<Response> =>
            importTokenFor(
                AuthHandlers.Qoder,
                (b) => AuthLogic.processProviderTokenImport("qoder", b),
                c
            )
    }
};
