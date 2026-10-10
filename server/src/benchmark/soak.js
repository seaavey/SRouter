// src/benchmark/soak.js
// Soak (endurance) test: Sustained moderate load to detect memory leaks and connection exhaustion over time.

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders } from "./config.js";
import { metrics, randomSleep } from "./helpers.js";

const duration = __ENV.SOAK_DURATION || "2m"; // Default 2 minutes, can be extended e.g. "30m" or "2h"

export const options = {
    scenarios: {
        soak_test: {
            executor: "constant-vus",
            vus: 30, // 30 concurrent users steadily
            duration: duration
        }
    },
    thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<50", "p(99)<150"]
    }
};

const headers = getHeaders(true);

export default function () {
    // Interleave requests between /health and /v1/pricing/models
    const res = http.get(`${CONFIG.baseUrl}/health`, {
        headers: headers,
        timeout: CONFIG.timeout
    });

    metrics.healthDuration.add(res.timings.duration);

    const ok = check(res, {
        "soak status is 200": (r) => r.status === 200
    });

    if (ok) metrics.successfulRequests.add(1);
    else metrics.errorRate.add(1);

    sleep(randomSleep(0.2, 0.5));
}
