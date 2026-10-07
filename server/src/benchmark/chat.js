// src/benchmark/chat.js
// Benchmark for POST /v1/chat (and /v1/chat/completions) with streaming & non-streaming random output.

import http from "k6/http";
import { check, sleep } from "k6";
import { CONFIG, getHeaders, THRESHOLDS } from "./config.js";
import { metrics, createRandomChatPayload, parseSseStream, randomSleep } from "./helpers.js";

export const options = {
    scenarios: {
        chat_random_output: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "10s", target: 3 }, // Warm-up (3 VUs)
                { duration: "25s", target: 10 }, // Moderate load (10 VUs)
                { duration: "20s", target: 20 }, // Concurrency peak (20 VUs)
                { duration: "10s", target: 0 } // Cool down
            ],
            gracefulRampDown: "10s"
        }
    },
    thresholds: THRESHOLDS.chat
};

const headers = getHeaders(true);
let firstStreamLogged = false;
let firstNonStreamLogged = false;

export default function () {
    // Determine whether this request is streaming or non-streaming
    let isStream = false;
    if (CONFIG.streamMode === "stream") {
        isStream = true;
    } else if (CONFIG.streamMode === "non-stream") {
        isStream = false;
    } else {
        // "mixed" mode: 50% probability for stream vs non-stream
        isStream = Math.random() < 0.5;
    }

    // Generate random prompt, temperature, max_tokens, and payload
    const { payload, prompt, topic, nonce, temperature, maxTokens } = createRandomChatPayload(
        CONFIG.defaultModel,
        isStream
    );

    const targetUrl = `${CONFIG.baseUrl}${CONFIG.chatEndpoint}`;
    const res = http.post(targetUrl, payload, {
        headers: headers,
        timeout: CONFIG.timeout
    });

    metrics.chatDuration.add(res.timings.duration);

    let ok = false;
    let sampleOutput = "";

    if (isStream) {
        metrics.streamRequests.add(1);
        metrics.chatStreamDuration.add(res.timings.duration);
        metrics.chatStreamTTFB.add(res.timings.waiting);

        const sseResult = parseSseStream(res.body || "");
        metrics.chatChunksCount.add(sseResult.chunkCount);
        sampleOutput = sseResult.text;

        ok = check(res, {
            "stream status 200": (r) => r.status === 200,
            "stream content-type is event-stream": (r) => {
                const ct = r.headers["Content-Type"] || r.headers["content-type"] || "";
                return ct.includes("text/event-stream");
            },
            "stream received sse chunks": () => sseResult.chunkCount > 0,
            "stream output non-empty": () => sampleOutput.length > 0
        });

        // Print first sample stream output or if SHOW_OUTPUT is enabled
        if ((!firstStreamLogged || CONFIG.showOutput) && sampleOutput) {
            firstStreamLogged = true;
            console.log(
                `\n[STREAM SAMPLE | ${topic} | T=${temperature}]\n` +
                    `PROMPT: ${prompt}\n` +
                    `OUTPUT: ${sampleOutput}\n` +
                    `CHUNKS: ${sseResult.chunkCount} | DURATION: ${res.timings.duration.toFixed(1)}ms | TTFB: ${res.timings.waiting.toFixed(1)}ms`
            );
        }
    } else {
        metrics.nonStreamRequests.add(1);
        metrics.chatNonStreamDuration.add(res.timings.duration);

        try {
            const data = JSON.parse(res.body);
            if (data.choices && data.choices[0] && data.choices[0].message) {
                sampleOutput = data.choices[0].message.content || "";
            }
        } catch (_) {}

        ok = check(res, {
            "non-stream status 200": (r) => r.status === 200,
            "non-stream valid choices": (r) => {
                try {
                    const data = JSON.parse(r.body);
                    return Array.isArray(data.choices) && data.choices.length > 0;
                } catch (_) {
                    return false;
                }
            },
            "non-stream output non-empty": () => sampleOutput.length > 0
        });

        // Print first sample non-stream output or if SHOW_OUTPUT is enabled
        if ((!firstNonStreamLogged || CONFIG.showOutput) && sampleOutput) {
            firstNonStreamLogged = true;
            console.log(
                `\n[NON-STREAM SAMPLE | ${topic} | T=${temperature}]\n` +
                    `PROMPT: ${prompt}\n` +
                    `OUTPUT: ${sampleOutput}\n` +
                    `DURATION: ${res.timings.duration.toFixed(1)}ms`
            );
        }
    }

    if (ok) {
        metrics.successfulRequests.add(1);
    } else {
        metrics.errorRate.add(1);
    }

    sleep(randomSleep(0.2, 0.8));
}
