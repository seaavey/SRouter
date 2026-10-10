// src/benchmark/health.js
// High-throughput benchmark for GET /health to measure raw Axum gateway baseline latency & RPS.

import http from "k6/http";
import { check } from "k6";
import { CONFIG, getHeaders, THRESHOLDS } from "./config.js";
import { metrics } from "./helpers.js";

export const options = {
    scenarios: {
        health_benchmark: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "10s", target: 20 }, // Warm-up ramp to 20 VUs
                { duration: "20s", target: 50 }, // Ramp to 50 VUs
                { duration: "30s", target: 100 }, // Peak load at 100 VUs
                { duration: "15s", target: 50 }, // Step down to 50 VUs
                { duration: "10s", target: 0 } // Cool down to 0
            ],
            gracefulRampDown: "5s"
        }
    },
    thresholds: THRESHOLDS.gatewayBaseline
};

const headers = getHeaders(false);

export default function () {
    const res = http.get(`${CONFIG.baseUrl}/health`, {
        headers: headers,
        timeout: CONFIG.timeout
    });

    metrics.healthDuration.add(res.timings.duration);

    const ok = check(res, {
        "status is 200": (r) => r.status === 200,
        "body is ok": (r) => {
            try {
                return JSON.parse(r.body).status === "ok";
            } catch (_) {
                return false;
            }
        }
    });

    if (ok) {
        metrics.successfulRequests.add(1);
    } else {
        metrics.errorRate.add(1);
    }
}
