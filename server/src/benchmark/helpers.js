// src/benchmark/helpers.js
// Utility functions and custom metrics for k6 benchmark tests

import { Trend, Rate, Counter } from "k6/metrics";

// Custom Trends to track individual endpoint latencies
export const metrics = {
    healthDuration: new Trend("srouter_health_duration_ms", true),
    apiInfoDuration: new Trend("srouter_api_info_duration_ms", true),
    modelsDuration: new Trend("srouter_models_duration_ms", true),
    pricingDuration: new Trend("srouter_pricing_duration_ms", true),

    // Chat specific metrics
    chatDuration: new Trend("srouter_chat_total_duration_ms", true),
    chatNonStreamDuration: new Trend("srouter_chat_non_stream_duration_ms", true),
    chatStreamDuration: new Trend("srouter_chat_stream_duration_ms", true),
    chatStreamTTFB: new Trend("srouter_chat_stream_ttfb_ms", true),
    chatChunksCount: new Trend("srouter_chat_stream_chunks_count"),

    // General counters and rates
    errorRate: new Rate("srouter_custom_error_rate"),
    successfulRequests: new Counter("srouter_successful_requests"),
    streamRequests: new Counter("srouter_chat_stream_requests"),
    nonStreamRequests: new Counter("srouter_chat_non_stream_requests")
};

// Curated diverse topics for generating randomized prompts
const TOPICS = [
    "quantum computing",
    "deep sea exploration",
    "ancient civilizations",
    "black holes",
    "synthetic biology",
    "sourdough fermentation",
    "cyberpunk aesthetic",
    "superconductors",
    "mars terraforming",
    "jazz improvisation",
    "distributed systems",
    "origami engineering",
    "neural architectures",
    "antarctic ecosystems",
    "cryptographic zero-knowledge",
    "renaissance geometry",
    "nanotechnology",
    "linguistic evolution",
    "volcanic geothermal energy",
    "exoplanet atmospheres"
];

// Prompt templates designed to evoke non-deterministic, creative, and varied responses
const PROMPT_TEMPLATES = [
    (topic, nonce) =>
        `Tell me one obscure and surprising fact about ${topic}. Keep it concise (1-2 sentences). [ref:${nonce}]`,
    (topic, nonce) =>
        `Write a 2-sentence micro-story with an unexpected twist revolving around ${topic}. [ref:${nonce}]`,
    (topic, nonce) =>
        `Invent an imaginative futuristic gadget inspired by ${topic}. Give it a unique name and 1-sentence function. [ref:${nonce}]`,
    (topic, nonce) =>
        `Write a philosophical thought experiment about ${topic} in 2 sentences. [ref:${nonce}]`,
    (topic, nonce) =>
        `Give 3 completely unexpected keywords or metaphors associated with ${topic}. [ref:${nonce}]`,
    (topic, nonce) =>
        `Explain how ${topic} might change in the year 2150 in one brief paragraph. [ref:${nonce}]`
];

// Generates a randomized prompt and tracking metadata
export function getRandomPrompt() {
    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    const template = PROMPT_TEMPLATES[Math.floor(Math.random() * PROMPT_TEMPLATES.length)];
    const nonce = Math.random().toString(36).substring(2, 8) + Date.now().toString(36).substring(4);
    const prompt = template(topic, nonce);
    return { prompt, topic, nonce };
}

// Generates a randomized chat completion payload for diverse outputs
export function createRandomChatPayload(model, isStream = false) {
    const { prompt, topic, nonce } = getRandomPrompt();
    // Randomize temperature between 0.70 and 1.00 to encourage varied output
    const temperature = parseFloat((0.7 + Math.random() * 0.3).toFixed(2));
    // Vary max_tokens between 30 and 75
    const maxTokens = randomInt(30, 75);

    const payload = JSON.stringify({
        model: model,
        messages: [
            {
                role: "system",
                content:
                    "You are a helpful and concise AI. Always answer creatively and directly without fluff."
            },
            {
                role: "user",
                content: prompt
            }
        ],
        stream: isStream,
        temperature: temperature,
        max_tokens: maxTokens
    });

    return {
        payload,
        prompt,
        topic,
        nonce,
        temperature,
        maxTokens
    };
}

// Parse SSE response body into reconstructed text content and chunk count
export function parseSseStream(body) {
    const lines = body.split("\n");
    let reconstructedText = "";
    let chunkCount = 0;
    let hasDone = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("data:")) continue;

        const dataStr = line.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") {
            hasDone = true;
            continue;
        }

        try {
            const parsed = JSON.parse(dataStr);
            chunkCount++;
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                const deltaContent = parsed.choices[0].delta.content;
                if (deltaContent) {
                    reconstructedText += deltaContent;
                }
            }
        } catch (_) {
            // Ignore non-json chunks or partial frames
        }
    }

    return {
        text: reconstructedText.trim(),
        chunkCount,
        hasDone
    };
}

// Random integer generator between min and max inclusive
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep helper with random jitter (seconds)
export function randomSleep(minSeconds = 0.1, maxSeconds = 0.5) {
    return Math.random() * (maxSeconds - minSeconds) + minSeconds;
}
