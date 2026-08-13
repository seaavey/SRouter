import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatCompletionChunk } from "@srouter/types";
import type { PlaygroundMessage, PlaygroundModel } from "@/components/playground/types";

type SseResult = "done" | "continue";

function getSseMessage(event: string): string | null {
    const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
        .trim();

    return data || null;
}

function getStreamError(payload: unknown): string | null {
    if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
    const error = payload.error;
    if (typeof error === "string") return error;
    if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error.message;
    }
    return "The gateway returned a streaming error.";
}

function shellQuote(value: string) {
    return `'${value.replaceAll("'", `"'"'`)}'`;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant connected via SRouter gateway.";

/**
 * Drives the playground chat: request parameters, message history, and the
 * SSE streaming call against `/v1/chat/completions`.
 */
export function usePlayground(initialModel: string, models: PlaygroundModel[]) {
    const [model, setModel] = useState(initialModel);
    const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
    const [temperature, setTemperature] = useState(0.7);
    const [topP, setTopP] = useState(1.0);
    const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [showParamsSheet, setShowParamsSheet] = useState(false);
    const [showCodeSheet, setShowCodeSheet] = useState(false);
    const [copiedSnippet, setCopiedSnippet] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const selectedModel = models.find((item) => item.id === model);
    const hasUsableModel = Boolean(selectedModel);
    const apiBase = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    function requestMessages(
        currentMessages: PlaygroundMessage[] = messages,
    ): Array<{ role: string; content: string }> {
        return [
            ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
            ...(currentMessages.length > 0
                ? currentMessages
                : [{ role: "user", content: "Hello SRouter!" }]),
        ];
    }

    async function send() {
        const content = input.trim();
        if (!content || streaming || !selectedModel) return;

        const userMessage: PlaygroundMessage = { role: "user", content };
        const updatedMessages = [...messages, userMessage];
        const controller = new AbortController();
        abortRef.current = controller;
        setMessages(updatedMessages);
        setInput("");
        setStreaming(true);
        setStatusMessage("Generating response.");

        let assistantText = "";
        let assistantPlaceholder = false;

        const updateAssistant = (nextText: string) => {
            assistantText = nextText;
            setMessages((previous) => {
                const next = [...previous];
                const last = next.at(-1);
                if (last?.role === "assistant") {
                    next[next.length - 1] = { role: "assistant", content: nextText };
                } else {
                    next.push({ role: "assistant", content: nextText });
                }
                return next;
            });
        };

        try {
            const res = await fetch("/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: selectedModel.id,
                    messages: [
                        ...(systemPrompt.trim()
                            ? [{ role: "system", content: systemPrompt.trim() }]
                            : []),
                        ...updatedMessages,
                    ],
                    temperature,
                    top_p: topP,
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    stream: true,
                }),
            });

            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as {
                    error?: { message?: string };
                } | null;
                throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
            }
            if (!res.body) throw new Error("The gateway returned no response body.");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            setMessages((previous) => [...previous, { role: "assistant", content: "" }]);
            assistantPlaceholder = true;

            const processEvent = (event: string): SseResult => {
                const data = getSseMessage(event);
                if (!data) return "continue";
                if (data === "[DONE]") return "done";

                const payload = JSON.parse(data) as ChatCompletionChunk & { error?: unknown };
                const streamError = getStreamError(payload);
                if (streamError) throw new Error(streamError);

                const delta = payload.choices?.[0]?.delta?.content ?? "";
                if (delta) updateAssistant(assistantText + delta);
                return "continue";
            };

            let finished = false;
            while (!finished) {
                const { done, value } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                buffer = buffer.replaceAll("\r\n", "\n");

                const events = buffer.split("\n\n");
                buffer = events.pop() ?? "";
                for (const event of events) {
                    if (processEvent(event) === "done") finished = true;
                }
                if (done) break;
            }

            buffer += decoder.decode();
            if (buffer.trim()) processEvent(buffer);
            setStatusMessage("Response complete.");
        } catch (error) {
            if (controller.signal.aborted) {
                setMessages((previous) => {
                    const last = previous.at(-1);
                    return last?.role === "assistant" && !last.content
                        ? previous.slice(0, -1)
                        : previous;
                });
                setStatusMessage("Generation cancelled.");
            } else {
                const message = error instanceof Error ? error.message : "Unknown gateway error.";
                setMessages((previous) => {
                    const next = [...previous];
                    const last = next.at(-1);
                    if (assistantPlaceholder && last?.role === "assistant") {
                        next[next.length - 1] = {
                            role: "assistant",
                            content: assistantText
                                ? `${assistantText}\n\nError: ${message}`
                                : `Error: ${message}`,
                        };
                    } else {
                        next.push({ role: "assistant", content: `Error: ${message}` });
                    }
                    return next;
                });
                setStatusMessage(`Generation failed: ${message}`);
            }
        } finally {
            abortRef.current = null;
            setStreaming(false);
        }
    }

    const cancel = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const generatedRequest = {
        model: selectedModel?.id ?? "",
        messages: requestMessages(),
        temperature,
        top_p: topP,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        stream: true,
    };
    const generatedCurl = selectedModel
        ? `curl ${apiBase}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer srouter-key" \\\n  -d ${shellQuote(JSON.stringify(generatedRequest, null, 2))}`
        : "Select a model to generate a request.";

    const handleCopyCode = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(generatedCurl);
            setCopiedSnippet(true);
            setStatusMessage("Request code copied.");
            window.setTimeout(() => setCopiedSnippet(false), 1500);
        } catch {
            setStatusMessage("Could not copy request code.");
        }
    }, [generatedCurl]);

    return {
        model,
        setModel,
        selectedModel,
        systemPrompt,
        setSystemPrompt,
        temperature,
        setTemperature,
        topP,
        setTopP,
        maxTokens,
        setMaxTokens,
        input,
        setInput,
        messages,
        setMessages,
        streaming,
        statusMessage,
        showParamsSheet,
        setShowParamsSheet,
        showCodeSheet,
        setShowCodeSheet,
        copiedSnippet,
        hasUsableModel,
        generatedCurl,
        send,
        cancel,
        handleCopyCode,
    };
}
