// src/benchmark/index.js
// Main entry point: Multi-scenario benchmark runner for SRouter gateway.

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders } from "./config.js";
import { metrics, randomSleep, createChatPayload } from "./helpers.js";

export const options = {
    scenarios: {
        // Scenario 1: Health baseline traffic
        health_baseline: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "10s", target: 20 },
                { duration: "20s", target: 50 },
                { duration: "10s", target: 0 }
            ],
            exec: "scenarioHealth"
        },

        // Scenario 2: Catalog reads
        catalog_reads: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "10s", target: 10 },
                { duration: "20s", target: 25 },
                { duration: "10s", target: 0 }
            ],
            exec: "scenarioCatalog"
        }
    },
    thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<100"]
    }
};

const publicHeaders = getHeaders(false);
const authHeaders = getHeaders(true);

// 1. Scenario Handler: Health Check
export function scenarioHealth() {
    const res = http.get(`${CONFIG.baseUrl}/health`, {
        headers: publicHeaders,
        timeout: CONFIG.timeout
    });

    metrics.healthDuration.add(res.timings.duration);
    const ok = check(res, {
        "health status 200": (r) => r.status === 200
    });

    if (ok) metrics.successfulRequests.add(1);
    else metrics.errorRate.add(1);

    sleep(randomSleep(0.05, 0.2));
}

// 2. Scenario Handler: Catalog Reads
export function scenarioCatalog() {
    const res = http.get(`${CONFIG.baseUrl}/v1/pricing/models`, {
        headers: authHeaders,
        timeout: CONFIG.timeout
    });

    metrics.pricingDuration.add(res.timings.duration);
    const ok = check(res, {
        "pricing status 200": (r) => r.status === 200
    });

    if (ok) metrics.successfulRequests.add(1);
    else metrics.errorRate.add(1);

    sleep(randomSleep(0.1, 0.3));
}

// Default handler if run without specific scenario
export default function () {
    scenarioHealth();
}

// Pretty summary formatter
export function handleSummary(data) {
    const p95 = data.metrics.http_req_duration?.values["p(95)"]?.toFixed(2) || "N/A";
    const p99 = data.metrics.http_req_duration?.values["p(99)"]?.toFixed(2) || "N/A";
    const avg = data.metrics.http_req_duration?.values.avg?.toFixed(2) || "N/A";
    const rps = data.metrics.http_reqs?.values.rate?.toFixed(2) || "N/A";
    const totalReqs = data.metrics.http_reqs?.values.count || 0;
    const fails = data.metrics.http_req_failed?.values.passes || 0;

    const report = `
======================================================
               SROUTER K6 BENCHMARK REPORT
======================================================
 Target Base URL   : ${CONFIG.baseUrl}
 Total Requests    : ${totalReqs}
 Failed Requests   : ${fails}
 Requests / Second : ${rps} req/s
 Latency Average   : ${avg} ms
 Latency p(95)      : ${p95} ms
 Latency p(99)      : ${p99} ms
======================================================
`;

    return {
        stdout: report,
        "summary.json": JSON.stringify(data, null, 2)
    };
}
