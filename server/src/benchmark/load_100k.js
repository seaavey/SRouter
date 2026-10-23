// Load test: ramp to 100k req/min against an isolated SRouter instance.
//
// The instance must be started separately with `cargo run --bin loadtest_server`
// (or the release binary) so it uses a temp DB and a local fake upstream — no
// real provider or live database is touched.
//
//   BASE_URL=http://127.0.0.1:3999 API_KEY=sr-live-loadtest-... \
//     k6 run src/benchmark/load_100k.js
//
// Traffic mix (mirrors a real agent fleet): 50% streaming chat, 40% buffered
// chat, 10% catalog read. Each VU issues ~1 request per iteration with a tiny
// sleep, so the request rate is roughly vus * 1000 / think_time_ms per minute.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3999";
const API_KEY = __ENV.API_KEY || "sr-live-loadtest-00000000-0000-0000-0000-000000000000";
const MODEL = __ENV.MODEL || "beam-free";

const chatErrors = new Rate("chat_errors");
const chatDuration = new Trend("chat_duration", true);
const streamErrors = new Rate("stream_errors");
const streamDuration = new Trend("stream_duration", true);
const catalogErrors = new Rate("catalog_errors");
const totalRequests = new Counter("total_requests");

// ~1,667 req/s = 100k/min. With ~1ms think time and ~30ms latency, we need
// roughly 1,700 concurrent VUs to sustain it on a 4-core box.
const TARGET_RPS = Number(__ENV.TARGET_RPS || 1667);
const DURATION = __ENV.DURATION || "3m";
const RAMP_UP = __ENV.RAMP_UP || "30s";
// Reuse TCP connections across iterations. With per-request connection churn
// the listen backlog (128) overflows and connections are reset (k6 status 0)
// long before the gateway is CPU-bound; keep-alive isolates request-processing
// throughput from connection-establishment throughput.
const KEEPALIVE = (__ENV.KEEPALIVE || "true") !== "false";

export const options = {
    scenarios: {
        load: {
            executor: "ramping-arrival-rate",
            startRate: 0,
            timeUnit: "1s",
            preAllocatedVUs: 2000,
            maxVUs: 5000,
            stages: [
                { duration: RAMP_UP, target: TARGET_RPS }, // ramp up
                { duration: DURATION, target: TARGET_RPS }, // hold
                { duration: "30s", target: 0 }, // ramp down
            ],
        },
    },
    noConnectionReuse: !KEEPALIVE,
    thresholds: {
        http_req_failed: ["rate<0.01"], // < 1% failures
        http_req_duration: ["p(95)<2000", "p(99)<5000"], // 95% under 2s
        chat_errors: ["rate<0.01"],
        stream_errors: ["rate<0.01"],
    },
};

const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${API_KEY}`,
};

const streamHeaders = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${API_KEY}`,
};

function chatBody(stream) {
    return JSON.stringify({
        model: MODEL,
        stream: stream,
        messages: [
            { role: "system", content: "You are a load test agent." },
            { role: "user", content: `Load test message ${__VU}-${__ITER}. Reply with a short answer.` },
        ],
    });
}

export default function () {
    const roll = Math.random();
    totalRequests.add(1);

    if (roll < 0.5) {
        // streaming chat
        const res = http.post(`${BASE_URL}/v1/chat/completions`, chatBody(true), {
            headers: streamHeaders,
            tags: { name: "chat_stream" },
            timeout: "30s",
        });
        const ok = check(res, {
            "stream status 200": (r) => r.status === 200,
            "stream is SSE": (r) => (r.headers["Content-Type"] || "").includes("text/event-stream"),
        });
        if (ok) streamErrors.add(0);
        else streamErrors.add(1);
        streamDuration.add(res.timings.duration);
    } else if (roll < 0.9) {
        // buffered chat
        const res = http.post(`${BASE_URL}/v1/chat/completions`, chatBody(false), {
            headers: headers,
            tags: { name: "chat_buffered" },
            timeout: "30s",
        });
        const ok = check(res, {
            "buffered status 200": (r) => r.status === 200,
            "buffered has choices": (r) => {
                try {
                    return JSON.parse(r.body).choices !== undefined;
                } catch (_) {
                    return false;
                }
            },
        });
        if (ok) chatErrors.add(0);
        else chatErrors.add(1);
        chatDuration.add(res.timings.duration);
    } else {
        // catalog read
        const res = http.get(`${BASE_URL}/v1/models`, {
            headers: headers,
            tags: { name: "models_read" },
            timeout: "10s",
        });
        const ok = check(res, {
            "models status 200": (r) => r.status === 200,
        });
        if (ok) catalogErrors.add(0);
        else catalogErrors.add(1);
    }
}
