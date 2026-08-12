import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatCompletionChunk, ModelListResponse } from "@srouter/types";
import { CodeSheet } from "@/components/playground/code-sheet";
import { ConversationViewport } from "@/components/playground/conversation-viewport";
import { MessageComposer } from "@/components/playground/message-composer";
import { ParamsSheet } from "@/components/playground/params-sheet";
import { PlaygroundCommandBar } from "@/components/playground/playground-command-bar";
import type { PlaygroundMessage } from "@/components/playground/types";

export const Route = createFileRoute("/playground")({
    staticData: { title: "Playground" },
    validateSearch: (search: Record<string, unknown>) => ({
        model: (search.model as string) || "",
    }),
    component: PlaygroundPage,
});

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
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "The gateway returned a streaming error.";
}

function shellQuote(value: string) {
    return `'${value.replaceAll("'", `"'"'`)}'`;
}

function PlaygroundPage() {
    const search = useSearch({ from: "/playground" });
    const {
        data: modelsData,
        isPending: modelsPending,
        isError: modelsError,
        error: modelsQueryError,
        refetch: refetchModels,
    } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
    });

    const models = modelsData?.data ?? [];
    const [model, setModel] = useState(search.model || "");
    const [systemPrompt, setSystemPrompt] = useState("You are a helpful AI assistant connected via SRouter gateway.");
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

    useEffect(() => {
        if (models.length === 0) return;
        const requestedModel = search.model && models.some((item) => item.id === search.model) ? search.model : "";
        if (requestedModel && requestedModel !== model) {
            setModel(requestedModel);
            return;
        }
        if (!models.some((item) => item.id === model)) {
            setModel(models[0].id);
        }
    }, [model, models, search.model]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    const selectedModel = models.find((item) => item.id === model);
    const hasUsableModel = Boolean(selectedModel);
    const apiBase = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

    function requestMessages(currentMessages = messages): Array<{ role: string; content: string }> {
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
                        ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
                        ...updatedMessages,
                    ],
                    temperature,
                    top_p: topP,
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    stream: true,
                }),
            });

            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
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
                    return last?.role === "assistant" && !last.content ? previous.slice(0, -1) : previous;
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
                            content: assistantText ? `${assistantText}\n\nError: ${message}` : `Error: ${message}`,
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

    function cancel() {
        abortRef.current?.abort();
    }

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

    async function handleCopyCode() {
        try {
            await navigator.clipboard.writeText(generatedCurl);
            setCopiedSnippet(true);
            setStatusMessage("Request code copied.");
            window.setTimeout(() => setCopiedSnippet(false), 1500);
        } catch {
            setStatusMessage("Could not copy request code.");
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <PlaygroundCommandBar
                models={models}
                model={model}
                selectedModel={selectedModel}
                modelsPending={modelsPending}
                modelsError={modelsError}
                modelsQueryError={modelsQueryError}
                onModelChange={setModel}
                onRetryModels={() => void refetchModels()}
                onOpenParams={() => setShowParamsSheet(true)}
                onOpenCode={() => setShowCodeSheet(true)}
                onClear={() => setMessages([])}
                hasMessages={messages.length > 0}
            />

            <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden border border-border bg-background">
                    <ConversationViewport messages={messages} selectedModel={selectedModel} streaming={streaming} />
                    <MessageComposer
                        input={input}
                        selectedModel={selectedModel}
                        streaming={streaming}
                        onInputChange={setInput}
                        onSend={() => void send()}
                        onCancel={cancel}
                    />
                </div>

                <aside className="hidden min-h-0 border border-border bg-muted/10 xl:block" aria-label="Request summary">
                    <div className="border-b border-border/70 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Request summary</div>
                    <div className="divide-y divide-border/60 text-xs">
                        <div className="space-y-1 px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Model</p>
                            <p className="break-words font-mono text-[11px] leading-relaxed text-foreground">{selectedModel?.id ?? "Not selected"}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 px-4 py-4">
                            <div className="space-y-1">
                                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Temp</p>
                                <p className="font-mono text-[11px] text-foreground">{temperature.toFixed(2)}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Top P</p>
                                <p className="font-mono text-[11px] text-foreground">{topP.toFixed(2)}</p>
                            </div>
                        </div>
                        <div className="space-y-1 px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Max tokens</p>
                            <p className="font-mono text-[11px] text-foreground">{maxTokens ?? "Provider default"}</p>
                        </div>
                        <div className="space-y-1 px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">System prompt</p>
                            <p className="line-clamp-5 text-[11px] leading-relaxed text-muted-foreground">{systemPrompt || "No system prompt"}</p>
                            <button type="button" onClick={() => setShowParamsSheet(true)} className="pt-2 text-[11px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground">
                                Edit parameters
                            </button>
                        </div>
                    </div>
                </aside>
            </div>

            <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>

            <ParamsSheet
                open={showParamsSheet}
                onOpenChange={setShowParamsSheet}
                systemPrompt={systemPrompt}
                temperature={temperature}
                topP={topP}
                maxTokens={maxTokens}
                onSystemPromptChange={setSystemPrompt}
                onTemperatureChange={setTemperature}
                onTopPChange={setTopP}
                onMaxTokensChange={setMaxTokens}
            />
            <CodeSheet
                open={showCodeSheet}
                onOpenChange={setShowCodeSheet}
                generatedCurl={generatedCurl}
                canCopy={hasUsableModel}
                copied={copiedSnippet}
                onCopy={() => void handleCopyCode()}
            />
        </div>
    );
}
