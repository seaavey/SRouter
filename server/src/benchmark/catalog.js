// src/benchmark/catalog.js
// Benchmark for model catalog and pricing endpoints (/v1/models & /v1/pricing/models).

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders, THRESHOLDS } from "./config.js";
import { metrics, randomSleep } from "./helpers.js";

export const options = {
    scenarios: {
        catalog_reads: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "10s", target: 10 }, // Ramp to 10 VUs
                { duration: "25s", target: 30 }, // Sustain 30 VUs
                { duration: "15s", target: 50 }, // Burst to 50 VUs
                { duration: "10s", target: 0 } // Cool down
            ],
            gracefulRampDown: "5s"
        }
    },
    thresholds: THRESHOLDS.catalog
};

const headers = getHeaders(true);

export default function () {
    // 1. Benchmark GET /v1/models
    {
        const res = http.get(`${CONFIG.baseUrl}/v1/models`, {
            headers: headers,
            timeout: CONFIG.timeout
        });

        metrics.modelsDuration.add(res.timings.duration);

        const ok = check(res, {
            "models status 200": (r) => r.status === 200,
            "models returns array/data": (r) => {
                if (r.status !== 200) return false;
                try {
                    const parsed = JSON.parse(r.body);
                    return Array.isArray(parsed.data) || Array.isArray(parsed);
                } catch (_) {
                    return false;
                }
            }
        });

        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    // Small jitter between requests
    sleep(randomSleep(0.05, 0.2));

    // 2. Benchmark GET /v1/pricing/models
    {
        const res = http.get(`${CONFIG.baseUrl}/v1/pricing/models`, {
            headers: headers,
            timeout: CONFIG.timeout
        });

        metrics.pricingDuration.add(res.timings.duration);

        const ok = check(res, {
            "pricing status 200": (r) => r.status === 200,
            "pricing cache header present": (r) => {
                return (
                    r.headers["Cache-Control"] !== undefined ||
                    r.headers["cache-control"] !== undefined
                );
            }
        });

        if (ok) metrics.successfulRequests.add(1);
        else metrics.errorRate.add(1);
    }

    sleep(randomSleep(0.1, 0.3));
}
