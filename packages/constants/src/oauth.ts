// ─── OpenAI Codex OAuth ───

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_SCOPE =
    "openid profile email offline_access api.connectors.read api.connectors.invoke";
export const CODEX_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CODEX_OAUTH_ORIGINATOR = "codex_cli_rs";

// ─── Antigravity OAuth ───

export const ANTIGRAVITY_OAUTH_CLIENT_ID =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_OAUTH_CLIENT_SECRET = "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";
export const ANTIGRAVITY_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/antigravity/callback";
export const ANTIGRAVITY_OAUTH_SCOPE =
    "openid profile email https://www.googleapis.com/auth/cloud-platform";
export const ANTIGRAVITY_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const ANTIGRAVITY_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_OAUTH_PROMPT = "consent";

// ─── Perch OAuth ───
export const PERCH_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/perch/callback";
