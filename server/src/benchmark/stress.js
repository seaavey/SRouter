// src/benchmark/stress.js
// Stress testing script: Progressively pushes concurrency to find breaking points and verify rate-limiting defense.

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders, THRESHOLDS } from "./config.js";
import { metrics, randomSleep } from "./helpers.js";

export const options = {
    scenarios: {
        stress_test: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "15s", target: 50 }, // Ramp to 50 VUs
                { duration: "30s", target: 150 }, // Ramp to 150 VUs
                { duration: "30s", target: 300 }, // Push to 300 VUs (stress threshold)
                { duration: "20s", target: 300 }, // Hold peak
                { duration: "15s", target: 50 }, // Recovery phase
                { duration: "10s", target: 0 } // Cool down
            ],
            gracefulRampDown: "10s"
        }
    },
    thresholds: THRESHOLDS.stress
};

const publicHeaders = getHeaders(false);
const authHeaders = getHeaders(true);

export default function () {
    // 70% traffic to /health (pure gateway throughput)
    // 20% traffic to /v1/pricing/models (cached data read)
    // 10% traffic to /v1/models (authenticated dynamic catalog)
    const roll = Math.random();

    if (roll < 0.7) {
        const res = http.get(`${CONFIG.baseUrl}/health`, {
            headers: publicHeaders,
            timeout: CONFIG.timeout
        });
        metrics.healthDuration.add(res.timings.duration);
        const ok = check(res, {
            "health 200 under stress": (r) => r.status === 200
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    } else if (roll < 0.9) {
        const res = http.get(`${CONFIG.baseUrl}/v1/pricing/models`, {
            headers: authHeaders,
            timeout: CONFIG.timeout
        });
        metrics.pricingDuration.add(res.timings.duration);
        const ok = check(res, {
            "pricing 200 or 429 under stress": (r) => r.status === 200 || r.status === 429
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    } else {
        const res = http.get(`${CONFIG.baseUrl}/v1/models`, {
            headers: authHeaders,
            timeout: CONFIG.timeout
        });
        metrics.modelsDuration.add(res.timings.duration);
        const ok = check(res, {
            "models 200 or 429 under stress": (r) => r.status === 200 || r.status === 429
        });
        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    sleep(randomSleep(0.01, 0.1));
}
