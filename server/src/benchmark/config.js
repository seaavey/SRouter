// src/benchmark/config.js
// Configuration module for k6 benchmark tests on SRouter

export const CONFIG = {
    // Target base URL (default SRouter server port 3000)
    baseUrl: __ENV.BASE_URL || "http://localhost:3000",

    // Chat target endpoint (defaults to /v1/chat, can also be /v1/chat/completions)
    chatEndpoint: __ENV.CHAT_ENDPOINT || "/v1/chat",

    // Stream mode for chat tests: "mixed" (50% stream, 50% non-stream), "stream", or "non-stream"
    streamMode: __ENV.STREAM_MODE || "mixed",

    // Log sample model output to k6 console
    showOutput: __ENV.SHOW_OUTPUT === "true" || __ENV.VERBOSE === "true",

    // API Key for authenticated endpoints
    apiKey: __ENV.API_KEY || "sk-srouter-test-key",

    // Admin Session Cookie (if needed for admin routes)
    adminCookie: __ENV.ADMIN_COOKIE || "",

    // Default LLM model for chat completions benchmark
    defaultModel: __ENV.MODEL || "zen/big-pickle",

    // Enable/disable upstream LLM chat benchmark in multi-scenario runners
    enableChat: __ENV.ENABLE_CHAT === "true",

    // Default request timeout
    timeout: __ENV.TIMEOUT || "30s"
};

// Generates standard HTTP headers
export function getHeaders(authenticated = false) {
    const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "k6-benchmark-srouter/1.0"
    };

    if (authenticated && CONFIG.apiKey) {
        headers["Authorization"] = `Bearer ${CONFIG.apiKey}`;
    }

    if (CONFIG.adminCookie) {
        headers["Cookie"] = `srouter_admin_session=${CONFIG.adminCookie}`;
    }

    return headers;
}

// Common thresholds for different testing stages
export const THRESHOLDS = {
    // Strict baseline for raw gateway endpoints (/health, /v1)
    gatewayBaseline: {
        http_req_failed: ["rate<0.001"], // < 0.1% errors
        http_req_duration: ["p(95)<15", "p(99)<30"] // 95% under 15ms, 99% under 30ms
    },

    // Typical read endpoints (/v1/models, /v1/pricing/models)
    catalog: {
        http_req_failed: ["rate<0.01"], // < 1% errors
        http_req_duration: ["p(95)<100", "p(99)<250"] // 95% under 100ms
    },

    // Chat completions thresholds
    chat: {
        http_req_failed: ["rate<0.05"], // < 5% errors
        http_req_duration: ["p(95)<8000"] // 95% under 8s
    },

    // Stress testing thresholds
    stress: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(90)<500", "p(99)<1500"]
    }
};
