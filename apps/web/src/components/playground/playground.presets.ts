import type { StarterPrompt } from "./playground.types";

export const STARTER_PROMPTS: StarterPrompt[] = [
    {
        id: "ts-sse-parser",
        category: "Code Generation",
        title: "SSE Stream Parser",
        prompt: "Write a zero-dependency TypeScript stream parser for Server-Sent Events (SSE) that handles chunk splits across `data: ` frames and cleanly emits parsed JSON objects."
    },
    {
        id: "gateway-routing",
        category: "System Design",
        title: "LLM Gateway Failover",
        prompt: "Design a fault-tolerant failover algorithm for an LLM gateway that balances between OpenAI and Anthropic providers with latency-aware circuit breakers."
    },
    {
        id: "sql-indexing",
        category: "Database & Logs",
        title: "Audit Log Indexing",
        prompt: "Provide an optimal SQLite / PostgreSQL schema and compound B-tree index strategy for querying request logs with filters on provider, status_code, and created_at timestamp."
    },
    {
        id: "token-counter",
        category: "Architecture",
        title: "Tokenizer Architecture",
        prompt: "Explain how byte-pair encoding (BPE) works in modern LLMs (e.g. tiktoken/cl100k_base vs o200k_base) and why token counts differ between JSON payloads and plain text."
    }
];
