import type { Context } from "hono";
import { AuthLogic } from "@/logic/auth.logic.js";
import { AuthHandlers } from "@/services/authHandlers.js";
import {
    StatePayloadSchema,
    OAuthCallbackBodySchema,
    TokenImportBodySchema,
    type AuthProviderHandler,
    type OAuthCallbackBody,
    type OAuthLoginParams,
    type ProviderConfig,
    type TokenImportBody,
    type TokenImportParams
} from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

async function ExtractState(c: Context): Promise<string | undefined> {
    if (c.req.method !== "POST") return c.req.query("state");

    const body = await c.req.json().catch(() => null);
    return StatePayloadSchema.safeParse(body).data?.state ?? c.req.query("state");
}

function OAuthFor(
    handler: AuthProviderHandler,
    initiate: (params: OAuthLoginParams) => ReturnType<typeof AuthLogic.initiateOAuthPKCE>,
    c: Context,
    handleErrors: boolean
): Response {
    try {
        const result = initiate({
            clientId: c.req.query("client_id"),
            redirectUri: c.req.query("redirect_uri"),
            prompt: c.req.query("prompt")
        });

        return c.req.query("format") === "json" ? Ok(c, result) : c.redirect(result.authorizeUrl);
    } catch (error) {
        if (!handleErrors) throw error;
        return Err(c, error instanceof Error ? error.message : String(error), 400);
    }
}

async function CallbackFor(
    handler: AuthProviderHandler,
    processCallback: (code: string, state: string) => Promise<ProviderConfig>,
    c: Context
): Promise<Response> {
    const rawBody = c.req.method === "POST" ? await c.req.json().catch(() => null) : null;
    const body = OAuthCallbackBodySchema.safeParse(rawBody).data;

    let code = c.req.query("code") ?? body?.code;
    let state = c.req.query("state") ?? body?.state;

    if (body?.callbackUrl) {
        try {
            const url = new URL(body.callbackUrl);
            code = code ?? url.searchParams.get("code") ?? undefined;
            state = state ?? url.searchParams.get("state") ?? undefined;
        } catch {}
    }

    if (!code || !state) {
        return Err(c, "Missing required 'code' or 'state' parameters in OAuth callback", 400);
    }

    try {
        const provider = await processCallback(code, state);
        return Ok(c, { success: true, message: handler.oauthSuccessMessage, provider });
    } catch (error) {
        return Err(c, error instanceof Error ? error.message : String(error), 500);
    }
}

async function ImportTokenFor(
    handler: AuthProviderHandler,
    importLogic: (body: TokenImportParams) => ProviderConfig,
    c: Context
): Promise<Response> {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object") {
        return Err(c, "Invalid JSON body", 400);
    }

    const parsed = TokenImportBodySchema.safeParse(rawBody);
    if (!parsed.success) {
        return Err(c, parsed.error.issues[0]?.message ?? "Invalid request body", 400);
    }

    const provider = importLogic(parsed.data as TokenImportParams);
    return Ok(c, { success: true, message: handler.tokenImportMessage, provider }, 201);
}

export const AuthController = {
    OpenAI: {
        OAuth: (c: Context): Response =>
            OAuthFor(AuthHandlers.OpenAI, (p) => AuthLogic.initiateOAuthPKCE(p), c, false),
        Callback: (c: Context): Promise<Response> =>
            CallbackFor(
                AuthHandlers.OpenAI,
                (code, state) => AuthLogic.processOAuthCallback(code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(AuthHandlers.OpenAI, (b) => AuthLogic.processTokenImport(b), c)
    },

    Antigravity: {
        OAuth: (c: Context): Response =>
            OAuthFor(
                AuthHandlers.Antigravity,
                (p) => AuthLogic.initiateProviderOAuth("antigravity", p),
                c,
                true
            ),
        Callback: (c: Context): Promise<Response> =>
            CallbackFor(
                AuthHandlers.Antigravity,
                (code, state) => AuthLogic.processProviderOAuthCallback("antigravity", code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.Antigravity,
                (b) => AuthLogic.processProviderTokenImport("antigravity", b),
                c
            )
    },

    CommandCode: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.CommandCode,
                (b) => AuthLogic.processProviderTokenImport("commandcode", b),
                c
            )
    },

    Anthropic: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.Anthropic,
                (b) => AuthLogic.processProviderTokenImport("anthropic", b),
                c
            )
    },

    Claude: {
        OAuth: (c: Context): Response =>
            OAuthFor(
                AuthHandlers.Claude,
                (p) => AuthLogic.initiateProviderOAuth("claude", p),
                c,
                false
            ),
        Callback: (c: Context): Promise<Response> =>
            CallbackFor(
                AuthHandlers.Claude,
                (code, state) => AuthLogic.processProviderOAuthCallback("claude", code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.Claude,
                (b) => AuthLogic.processProviderTokenImport("claude", b),
                c
            )
    },

    GoRouter: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.GoRouter,
                (b) => AuthLogic.processProviderTokenImport("gorouter", b),
                c
            )
    },

    BluesMinds: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.BluesMinds,
                (b) => AuthLogic.processProviderTokenImport("bluesminds", b),
                c
            )
    },

    SeekAI: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.SeekAI,
                (b) => AuthLogic.processProviderTokenImport("seekai", b),
                c
            )
    },

    TabiToken: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.TabiToken,
                (b) => AuthLogic.processProviderTokenImport("tabitoken", b),
                c
            )
    },

    TokenRouter: {
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
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
                    return Ok(c, {
                        authorizeUrl: result.authorizeUrl,
                        state: result.state
                    });
                }
                return c.redirect(result.authorizeUrl);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                return Err(c, `Failed to initiate CodeBuddy login: ${message}`, 500);
            }
        },
        Poll: async (c: Context): Promise<Response> => {
            const state = await ExtractState(c);
            if (!state) {
                return Err(c, "Missing state parameter", 400);
            }

            const result = await AuthLogic.pollCodeBuddyDeviceToken(state);
            return Ok(c, result);
        },
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
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
                    return Ok(c, { authorizeUrl: result.authorizeUrl, state: result.state });
                }
                return c.redirect(result.authorizeUrl);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                return Err(c, `Failed to initiate CodeBuddy CN login: ${message}`, 500);
            }
        },
        Poll: async (c: Context): Promise<Response> => {
            const state = await ExtractState(c);
            if (!state) {
                return Err(c, "Missing state parameter", 400);
            }

            return Ok(c, await AuthLogic.pollCodeBuddyCNDeviceToken(state));
        },
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.CodeBuddyCN,
                (b) => AuthLogic.processProviderTokenImport("codebuddy-cn", b),
                c
            )
    },

    Qoder: {
        OAuth: (c: Context): Response =>
            OAuthFor(
                AuthHandlers.Qoder,
                (p) => AuthLogic.initiateProviderOAuth("qoder", p),
                c,
                true
            ),
        Callback: (c: Context): Promise<Response> =>
            CallbackFor(
                AuthHandlers.Qoder,
                (code, state) => AuthLogic.processProviderOAuthCallback("qoder", code, state),
                c
            ),
        Poll: async (c: Context): Promise<Response> => {
            const state = await ExtractState(c);
            if (!state) {
                return Err(c, "Missing state parameter", 400);
            }

            const result = await AuthLogic.pollQoderDeviceToken(state);
            return Ok(c, result);
        },
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.Qoder,
                (b) => AuthLogic.processProviderTokenImport("qoder", b),
                c
            )
    },

    Perch: {
        OAuth: (c: Context): Response =>
            OAuthFor(
                AuthHandlers.Perch,
                (p) => AuthLogic.initiateProviderOAuth("perch", p),
                c,
                true
            ),
        Callback: (c: Context): Promise<Response> =>
            CallbackFor(
                AuthHandlers.Perch,
                (code, state) => AuthLogic.processProviderOAuthCallback("perch", code, state),
                c
            ),
        ImportToken: (c: Context): Promise<Response> =>
            ImportTokenFor(
                AuthHandlers.Perch,
                (b) => AuthLogic.processProviderTokenImport("perch", b),
                c
            )
    }
};
