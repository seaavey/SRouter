import type { ReactNode } from "react";

/**
 * Konfigurasi alur koneksi OAuth/PAT per provider. Menambah provider baru
 * cukup menambah entri di OAUTH_FLOWS — tidak ada lagi nested ternary yang
 * tersebar di komponen modal.
 */

/** Tab PAT (Personal Access Token / API key) di dalam modal koneksi. */
export interface OAuthPatTabConfig {
    tabLabel: string;
    fieldLabel: string;
    description: ReactNode;
    placeholder: string;
    submitLabel: string;
}

/** Tab Bulk Add: impor banyak token sekaligus, satu per baris. */
export interface OAuthBulkTabConfig {
    fieldLabel: string;
    description: ReactNode;
    placeholder: string;
    /** Baris berformat "<access>,<refresh>" (khusus Codex). */
    parsePair: boolean;
}

export interface OAuthFlowConfig {
    loginEndpoint: string;
    /** Endpoint polling device/OAuth; kehadirannya mematikan Step 2 paste-callback. */
    pollEndpoint?: string;
    /** Endpoint callback untuk Step 2; fallback ke "/v1/auth/openai/callback" (perilaku lama). */
    callbackEndpoint?: string;
    patTab?: OAuthPatTabConfig;
    bulkTab?: OAuthBulkTabConfig;
    waitingLabel: string;
}

const OPENAI_LOGIN = "/v1/auth/openai/login?format=json";
const QODER_HELP_URL = "https://qoder.com/account/integrations";

function qoderHelpLink(className: string): ReactNode {
    return (
        <a href={QODER_HELP_URL} target="_blank" rel="noreferrer" className={className}>
            qoder.com/account/integrations
        </a>
    );
}

const openaiFlow: OAuthFlowConfig = {
    loginEndpoint: OPENAI_LOGIN,
    patTab: {
        tabLabel: "PAT Token",
        fieldLabel: "Codex Access Token",
        description: "Paste an OpenAI Codex access token (from ~/.codex/auth.json).",
        placeholder: "eyJhbGciOi...",
        submitLabel: "Connect PAT"
    },
    bulkTab: {
        fieldLabel: "Bulk Access Tokens",
        description: (
            <>
                Paste one Codex access token per line. Format:{" "}
                <code className="rounded-full bg-field px-2 py-0.5 text-[10px] font-mono">
                    access_token,refresh_token
                </code>
            </>
        ),
        placeholder: "eyJhbGciOi...\neyJhbGciOi...",
        parsePair: true
    },
    waitingLabel: "Waiting for browser authorization…"
};

const claudeFlow: OAuthFlowConfig = {
    loginEndpoint: "/v1/auth/claude/login?format=json",
    waitingLabel: "Waiting for browser authorization…"
};

function codebuddyFlow(authProviderId: string): OAuthFlowConfig {
    return {
        loginEndpoint: `/v1/auth/${authProviderId}/login?format=json`,
        pollEndpoint: `/v1/auth/${authProviderId}/poll`,
        patTab: {
            tabLabel: "Access Token",
            fieldLabel: "CodeBuddy Access Token",
            description: "Paste the Access Token / Bearer Token from your CodeBuddy account.",
            placeholder: "eyJhbGciOi...",
            submitLabel: "Connect CodeBuddy"
        },
        waitingLabel: "Waiting for CodeBuddy browser authorization…"
    };
}

const OAUTH_FLOWS: Record<string, OAuthFlowConfig> = {
    openai: openaiFlow,
    qoder: {
        loginEndpoint: "/v1/auth/qoder/login?format=json",
        pollEndpoint: "/v1/auth/qoder/poll",
        callbackEndpoint: "/v1/auth/qoder/callback",
        patTab: {
            tabLabel: "PAT Token",
            fieldLabel: "Personal Access Token (PAT)",
            description: (
                <>
                    Generate your PAT (`pt-...`) from{" "}
                    {qoderHelpLink(
                        "underline text-foreground hover:text-primary transition-colors"
                    )}
                </>
            ),
            placeholder: "pt-...",
            submitLabel: "Connect PAT"
        },
        bulkTab: {
            fieldLabel: "Bulk PATs",
            description: (
                <>
                    Paste multiple Qoder PATs (`pt-...`) from{" "}
                    {qoderHelpLink("underline text-ink hover:text-accent transition-colors")}, one
                    per line.
                </>
            ),
            placeholder: "pt-xxx...\npt-yyy...",
            parsePair: false
        },
        waitingLabel: "Waiting for Qoder browser authorization…"
    },
    codebuddy: codebuddyFlow("codebuddy"),
    "codebuddy-cn": codebuddyFlow("codebuddy-cn"),
    cline: {
        loginEndpoint: "/v1/auth/cline/device",
        pollEndpoint: "/v1/auth/cline/poll",
        patTab: {
            tabLabel: "API Key",
            fieldLabel: "Cline API Key",
            description: "Paste your official Cline API key. It will be sent as a Bearer token.",
            placeholder: "cline_...",
            submitLabel: "Connect API Key"
        },
        waitingLabel: "Waiting for browser authorization…"
    },
    antigravity: {
        loginEndpoint: "/v1/auth/antigravity/login?format=json",
        callbackEndpoint: "/v1/auth/antigravity/callback",
        waitingLabel: "Waiting for browser authorization…"
    },
    claude: claudeFlow,
    anthropic: claudeFlow
};

/**
 * Memetakan authProviderId (bagian dasar id provider, dengan pengecualian
 * "codebuddy-cn") ke konfigurasi alurnya. Provider tak dikenal memakai alur
 * OpenAI tanpa tab tambahan, mengikuti perilaku lama.
 */
export default function resolveOAuthFlow(authProviderId: string): OAuthFlowConfig {
    return (
        OAUTH_FLOWS[authProviderId] ?? {
            loginEndpoint: OPENAI_LOGIN,
            waitingLabel: "Waiting for browser authorization…"
        }
    );
}
