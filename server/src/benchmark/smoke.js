// src/benchmark/smoke.js
// Smoke test: Runs minimal requests (1 VU, short iterations) to verify all endpoints respond properly.

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders } from "./config.js";
import { metrics } from "./helpers.js";

export const options = {
    vus: 1,
    duration: "10s",
    thresholds: {
        http_req_failed: ["rate==0"], // Expect 0 failures in smoke test
        http_req_duration: ["p(95)<150"]
    }
};

export default function () {
    const publicHeaders = getHeaders(false);
    const authHeaders = getHeaders(true);

    // 1. Health check: GET /health
    {
        const res = http.get(`${CONFIG.baseUrl}/health`, { headers: publicHeaders });
        metrics.healthDuration.add(res.timings.duration);
        const ok = check(res, {
            "health status is 200": (r) => r.status === 200,
            "health body status is ok": (r) => {
                try {
                    return JSON.parse(r.body).status === "ok";
                } catch (_) {
                    return false;
                }
            }
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    // 2. API Info: GET /v1
    {
        const res = http.get(`${CONFIG.baseUrl}/v1`, { headers: publicHeaders });
        metrics.apiInfoDuration.add(res.timings.duration);
        const ok = check(res, {
            "v1 info status is 200": (r) => r.status === 200,
            "v1 info has name SRouter API": (r) => {
                try {
                    return JSON.parse(r.body).name === "SRouter API";
                } catch (_) {
                    return false;
                }
            }
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    // 3. Models catalog: GET /v1/models
    {
        const res = http.get(`${CONFIG.baseUrl}/v1/models`, { headers: authHeaders });
        metrics.modelsDuration.add(res.timings.duration);
        const ok = check(res, {
            "models catalog status is 200 or 401": (r) => r.status === 200 || r.status === 401,
            "models returns valid JSON": (r) => {
                if (r.status !== 200) return true;
                try {
                    const body = JSON.parse(r.body);
                    return Array.isArray(body.data) || Array.isArray(body);
                } catch (_) {
                    return false;
                }
            }
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    // 4. Pricing catalog: GET /v1/pricing/models
    {
        const res = http.get(`${CONFIG.baseUrl}/v1/pricing/models`, { headers: authHeaders });
        metrics.pricingDuration.add(res.timings.duration);
        const ok = check(res, {
            "pricing status is 200 or 401": (r) => r.status === 200 || r.status === 401,
            "pricing has cache header": (r) => {
                if (r.status !== 200) return true;
                return (
                    r.headers["Cache-Control"] !== undefined ||
                    r.headers["cache-control"] !== undefined
                );
            }
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    sleep(1);
}
