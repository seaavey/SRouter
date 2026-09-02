import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatCompletionChunk } from "@srouter/types";
import { toast } from "sonner";
import type {
    ExportLanguage,
    PlaygroundMessage,
    PlaygroundModel,
    PlaygroundSession
} from "@/components/playground/playground.types";
import { getGatewayBaseUrl } from "@/lib/api";
import { safeJsonParse } from "@/lib/utils";
import { generatePlaygroundCodeSnippet } from "@/utils/codeSnippetGenerator";

type SseResult = "done" | "continue";

const STORAGE_SESSIONS_KEY = "srouter_playground_sessions_v1";
const STORAGE_ACTIVE_ID_KEY = "srouter_playground_active_id_v1";

function generateChatId(): string {
    const randomHex = Math.random().toString(16).slice(2, 8);
    const dateStr = Date.now().toString(36).slice(-4);
    return `chat_${dateStr}${randomHex}`;
}

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

function loadStoredSessions(): PlaygroundSession[] {
    if (typeof window === "undefined") return [];
    return safeJsonParse<PlaygroundSession[]>(localStorage.getItem(STORAGE_SESSIONS_KEY), []);
}

function saveStoredSessions(sessions: PlaygroundSession[], activeId?: string) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
        if (activeId) {
            localStorage.setItem(STORAGE_ACTIVE_ID_KEY, activeId);
        }
    } catch {
        // ignore quota errors
    }
}

export function usePlayground(initialModel: string, models: PlaygroundModel[]) {
    // Session state
    const [sessions, setSessions] = useState<PlaygroundSession[]>(() => {
        const stored = loadStoredSessions();
        if (stored.length > 0) return stored;
        const initialId = generateChatId();
        const firstSession: PlaygroundSession = {
            id: initialId,
            title: "New Conversation",
            model: initialModel,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        return [firstSession];
    });

    const [activeChatId, setActiveChatId] = useState<string>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem(STORAGE_ACTIVE_ID_KEY);
            if (saved && sessions.some((s) => s.id === saved)) return saved;
        }
        return sessions[0]?.id || generateChatId();
    });

    const currentSession = sessions.find((s) => s.id === activeChatId) || sessions[0];

    const [model, setModel] = useState<string>(() => currentSession?.model || initialModel);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<PlaygroundMessage[]>(
        () => currentSession?.messages || []
    );
    const [streaming, setStreaming] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [showCodeSheet, setShowCodeSheet] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [thinkingEnabled, setThinkingEnabled] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [temperature, setTemperature] = useState(0.7);
    const [maxTokens, setMaxTokens] = useState(2048);
    const [exportLanguage, setExportLanguage] = useState<ExportLanguage>("curl");
    const [copiedSnippet, setCopiedSnippet] = useState(false);
    const [copiedChatId, setCopiedChatId] = useState(false);
    const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

    const abortRef = useRef<AbortController | null>(null);

    const selectedModel = models.find((item) => item.id === model);
    const hasUsableModel = Boolean(selectedModel);
    const apiBase = getGatewayBaseUrl();

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    // Sync session changes back to state & storage
    useEffect(() => {
        setSessions((prev) => {
            const index = prev.findIndex((s) => s.id === activeChatId);
            if (index === -1) return prev;

            const existing = prev[index];
            const firstUserMsg = messages.find((m) => m.role === "user");
            let title = existing.title;
            if (title === "New Conversation" && firstUserMsg?.content) {
                title =
                    firstUserMsg.content.slice(0, 32).trim() +
                    (firstUserMsg.content.length > 32 ? "..." : "");
            }

            const updated: PlaygroundSession = {
                ...existing,
                title,
                model,
                messages,
                updatedAt: Date.now()
            };

            const next = [...prev];
            next[index] = updated;
            saveStoredSessions(next, activeChatId);
            return next;
        });
    }, [messages, model, activeChatId]);

    // Create a new session with unique chat_id
    const createSession = useCallback(
        (targetModel?: string) => {
            const newId = generateChatId();
            const newSession: PlaygroundSession = {
                id: newId,
                title: "New Conversation",
                model: targetModel || model || initialModel,
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            setSessions((prev) => {
                const next = [newSession, ...prev];
                saveStoredSessions(next, newId);
                return next;
            });

            setActiveChatId(newId);
            setMessages([]);
            setInput("");
            if (typeof document !== "undefined") {
                document.title = "Playground · SRouter";
            }
            toast.success(`Started new session: ${newId}`);
        },
        [model, initialModel]
    );

    // Switch between sessions
    const switchSession = useCallback(
        (sessionId: string) => {
            const target = sessions.find((s) => s.id === sessionId);
            if (!target) return;

            if (streaming) {
                abortRef.current?.abort();
                setStreaming(false);
            }

            setActiveChatId(sessionId);
            setMessages(target.messages || []);
            setModel(target.model || model);
            setInput("");
            saveStoredSessions(sessions, sessionId);
            if (typeof document !== "undefined") {
                document.title =
                    target.title && target.title !== "New Conversation"
                        ? `${target.title} · SRouter`
                        : "Playground · SRouter";
            }
            toast.info(`Switched to session: ${target.title || target.id}`);
        },
        [sessions, model, streaming]
    );

    // Delete a session
    const deleteSession = useCallback(
        (sessionId: string) => {
            setSessions((prev) => {
                const next = prev.filter((s) => s.id !== sessionId);
                if (next.length === 0) {
                    const fallbackId = generateChatId();
                    const fallback: PlaygroundSession = {
                        id: fallbackId,
                        title: "New Conversation",
                        model: model || initialModel,
                        messages: [],
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    };
                    saveStoredSessions([fallback], fallbackId);
                    setActiveChatId(fallbackId);
                    setMessages([]);
                    return [fallback];
                }

                if (sessionId === activeChatId) {
                    const first = next[0];
                    setActiveChatId(first.id);
                    setMessages(first.messages || []);
                    setModel(first.model || model);
                }

                saveStoredSessions(next, sessionId === activeChatId ? next[0].id : activeChatId);
                return next;
            });
            toast.info("Session deleted");
        },
        [activeChatId, model, initialModel]
    );

    const copyChatId = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(activeChatId);
            setCopiedChatId(true);
            toast.success(`Copied chat_id: ${activeChatId}`);
            setTimeout(() => setCopiedChatId(false), 2000);
        } catch {
            toast.error("Failed to copy chat_id");
        }
    }, [activeChatId]);

    function requestMessages(
        currentMessages: PlaygroundMessage[] = messages
    ): Array<{ role: string; content: string }> {
        const base =
            currentMessages.length > 0
                ? currentMessages.map((m) => ({ role: m.role, content: m.content }))
                : [{ role: "user", content: "Hello SRouter!" }];
        if (systemPrompt.trim()) {
            return [{ role: "system", content: systemPrompt.trim() }, ...base];
        }
        return base;
    }

    const send = useCallback(
        async (customPrompt?: string) => {
            const content = (customPrompt ?? input).trim();
            if (!content || streaming || !selectedModel) return;

            const startTime = Date.now();
            const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            const userMessage: PlaygroundMessage = {
                id: userMsgId,
                role: "user",
                content,
                createdAt: startTime
            };

            const initialAssistantMessage: PlaygroundMessage = {
                id: assistantMsgId,
                role: "assistant",
                content: "",
                createdAt: startTime,
                durationMs: 0
            };

            const updatedMessages = [...messages, userMessage];
            const controller = new AbortController();
            abortRef.current = controller;

            // Immediately show user message + assistant card (0ms instant response)
            setMessages([...updatedMessages, initialAssistantMessage]);
            if (!customPrompt) setInput("");
            setStreaming(true);
            setStatusMessage("Generating response.");

            let assistantText = "";
            let assistantUsage:
                | {
                      promptTokens: number;
                      completionTokens: number;
                      totalTokens: number;
                      cachedTokens?: number;
                  }
                | undefined = undefined;

            const updateAssistant = (nextText: string, isErr = false, usage = assistantUsage) => {
                assistantText = nextText;
                setMessages((previous) => {
                    const next = [...previous];
                    const lastIdx = next.findIndex((m) => m.id === assistantMsgId);
                    const duration = Date.now() - startTime;

                    const msgData: PlaygroundMessage = {
                        id: assistantMsgId,
                        role: "assistant",
                        content: nextText,
                        createdAt: startTime,
                        durationMs: duration,
                        error: isErr,
                        usage
                    };

                    if (lastIdx !== -1) {
                        next[lastIdx] = msgData;
                    } else {
                        next.push(msgData);
                    }
                    return next;
                });
            };

            try {
                const outboundMessages = systemPrompt.trim()
                    ? [
                          { role: "system", content: systemPrompt.trim() },
                          ...updatedMessages.map((m) => ({ role: m.role, content: m.content }))
                      ]
                    : updatedMessages.map((m) => ({ role: m.role, content: m.content }));

                const res = await fetch("/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "text/event-stream",
                        "X-Chat-ID": activeChatId
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: selectedModel.id,
                        messages: outboundMessages,
                        stream: true,
                        temperature,
                        max_tokens: maxTokens,
                        stream_options: { include_usage: true },
                        ...(thinkingEnabled ? { reasoning_effort: "high" } : {})
                    })
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

                // Initial empty assistant message placeholder
                updateAssistant("");

                const processEvent = (event: string): SseResult => {
                    const data = getSseMessage(event);
                    if (!data) return "continue";
                    if (data === "[DONE]") return "done";

                    const payload = JSON.parse(data) as ChatCompletionChunk & {
                        error?: unknown;
                        usage?: {
                            prompt_tokens?: number;
                            completion_tokens?: number;
                            total_tokens?: number;
                            prompt_tokens_details?: {
                                cached_tokens?: number;
                                cache_read_input_tokens?: number;
                            };
                            cache_read_tokens?: number;
                        };
                    };
                    const streamError = getStreamError(payload);
                    if (streamError) throw new Error(streamError);

                    if (payload.usage) {
                        const u = payload.usage;
                        const promptTokens = u.prompt_tokens ?? 0;
                        const completionTokens = u.completion_tokens ?? 0;
                        const cachedTokens =
                            u.prompt_tokens_details?.cached_tokens ??
                            u.prompt_tokens_details?.cache_read_input_tokens ??
                            u.cache_read_tokens ??
                            undefined;
                        assistantUsage = {
                            promptTokens,
                            completionTokens,
                            totalTokens: u.total_tokens ?? promptTokens + completionTokens,
                            cachedTokens:
                                cachedTokens && cachedTokens > 0 ? cachedTokens : undefined
                        };
                    }

                    const delta =
                        payload.choices?.[0]?.delta?.content ??
                        (payload.choices?.[0]?.delta as unknown as { reasoning_content?: string })
                            ?.reasoning_content ??
                        (payload.choices?.[0]?.delta as unknown as { thought?: string })?.thought ??
                        (payload.choices?.[0]?.delta as unknown as { thinking?: string })
                            ?.thinking ??
                        "";
                    if (delta) updateAssistant(assistantText + delta, false, assistantUsage);
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

                // If upstream stream didn't provide usage, compute estimate
                if (!assistantUsage && assistantText) {
                    const promptChars = updatedMessages.reduce(
                        (sum, m) => sum + m.content.length,
                        0
                    );
                    const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
                    const completionTokens = Math.max(1, Math.ceil(assistantText.length / 4));
                    assistantUsage = {
                        promptTokens,
                        completionTokens,
                        totalTokens: promptTokens + completionTokens
                    };
                }

                updateAssistant(assistantText, false, assistantUsage);

                const totalDuration = Date.now() - startTime;
                setLastLatencyMs(totalDuration);
                setStatusMessage(`Response complete (${(totalDuration / 1000).toFixed(2)}s).`);

                // Request dynamic follow-up prompt suggestions directly from AI
                const fetchFollowUps = async () => {
                    try {
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantMsgId ? { ...m, isGeneratingFollowUps: true } : m
                            )
                        );

                        const followUpRes = await fetch("/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "X-Chat-ID": activeChatId
                            },
                            body: JSON.stringify({
                                model: selectedModel.id,
                                messages: [
                                    ...updatedMessages
                                        .slice(-3)
                                        .map((m) => ({ role: m.role, content: m.content })),
                                    { role: "assistant", content: assistantText.slice(0, 1500) },
                                    {
                                        role: "user",
                                        content:
                                            'Suggest 3 brief, actionable follow-up prompt questions the user might ask next based on this response. Return ONLY a JSON array of 3 strings, e.g. ["question 1", "question 2", "question 3"]. No other text.'
                                    }
                                ],
                                max_tokens: 150,
                                temperature: 0.6
                            })
                        });

                        if (followUpRes.ok) {
                            const data = await followUpRes.json();
                            const rawContent = data?.choices?.[0]?.message?.content ?? "";
                            let parsedFollowUps: string[] = [];

                            const match = rawContent.match(/\[[\s\S]*\]/);
                            if (match) {
                                try {
                                    const parsed = JSON.parse(match[0]);
                                    if (Array.isArray(parsed)) {
                                        parsedFollowUps = parsed
                                            .filter(
                                                (item) =>
                                                    typeof item === "string" &&
                                                    item.trim().length > 0
                                            )
                                            .map((item) => item.trim())
                                            .slice(0, 4);
                                    }
                                } catch {
                                    // ignore JSON error
                                }
                            }

                            if (parsedFollowUps.length === 0 && rawContent) {
                                parsedFollowUps = rawContent
                                    .split("\n")
                                    .map((l: string) =>
                                        l.replace(/^\d+[\.\)]\s*|-\s*|"\s*|,\s*$/g, "").trim()
                                    )
                                    .filter(
                                        (l: string) =>
                                            l.length > 5 && !l.startsWith("[") && !l.endsWith("]")
                                    )
                                    .slice(0, 3);
                            }

                            if (parsedFollowUps.length > 0) {
                                setMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === assistantMsgId
                                            ? {
                                                  ...m,
                                                  followUps: parsedFollowUps,
                                                  isGeneratingFollowUps: false
                                              }
                                            : m
                                    )
                                );
                            } else {
                                setMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === assistantMsgId
                                            ? { ...m, isGeneratingFollowUps: false }
                                            : m
                                    )
                                );
                            }
                        } else {
                            setMessages((prev) =>
                                prev.map((m) =>
                                    m.id === assistantMsgId
                                        ? { ...m, isGeneratingFollowUps: false }
                                        : m
                                )
                            );
                        }
                    } catch {
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantMsgId ? { ...m, isGeneratingFollowUps: false } : m
                            )
                        );
                    }
                };

                void fetchFollowUps();

                // Request dynamic session title from AI if session still has default title
                const currentSessionObj = sessions.find((s) => s.id === activeChatId);
                if (
                    currentSessionObj &&
                    (currentSessionObj.title === "New Conversation" || !currentSessionObj.title)
                ) {
                    const fetchTitle = async () => {
                        try {
                            const titleRes = await fetch("/v1/chat/completions", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "X-Chat-ID": activeChatId
                                },
                                body: JSON.stringify({
                                    model: selectedModel.id,
                                    messages: [
                                        {
                                            role: "user",
                                            content: `Summarize this user request into a concise 3-5 words title. Return ONLY the title without quotes, punctuation, or markdown:\n\n${content.slice(0, 300)}`
                                        }
                                    ],
                                    max_tokens: 20,
                                    temperature: 0.4
                                })
                            });

                            if (titleRes.ok) {
                                const titleData = await titleRes.json();
                                const rawTitle = titleData?.choices?.[0]?.message?.content
                                    ?.trim()
                                    .replace(/^["'`]|["'`]$/g, "");
                                if (rawTitle && rawTitle.length > 2 && rawTitle.length < 60) {
                                    setSessions((prev) => {
                                        const next = prev.map((s) =>
                                            s.id === activeChatId ? { ...s, title: rawTitle } : s
                                        );
                                        saveStoredSessions(next, activeChatId);
                                        return next;
                                    });
                                    if (typeof document !== "undefined") {
                                        document.title = `${rawTitle} · SRouter`;
                                    }
                                }
                            }
                        } catch {
                            const fallbackTitle = content.slice(0, 26).trim() + "...";
                            setSessions((prev) => {
                                const next = prev.map((s) =>
                                    s.id === activeChatId ? { ...s, title: fallbackTitle } : s
                                );
                                saveStoredSessions(next, activeChatId);
                                return next;
                            });
                            if (typeof document !== "undefined") {
                                document.title = `${fallbackTitle} · SRouter`;
                            }
                        }
                    };
                    void fetchTitle();
                }
            } catch (error) {
                if (controller.signal.aborted) {
                    setMessages((previous) => {
                        const last = previous.at(-1);
                        return last?.id === assistantMsgId && !last.content
                            ? previous.slice(0, -1)
                            : previous;
                    });
                    setStatusMessage("Generation cancelled.");
                } else {
                    const message =
                        error instanceof Error ? error.message : "Unknown gateway error.";
                    updateAssistant(
                        assistantText
                            ? `${assistantText}\n\nError: ${message}`
                            : `Error: ${message}`,
                        true
                    );
                    setStatusMessage(`Generation failed: ${message}`);
                }
            } finally {
                abortRef.current = null;
                setStreaming(false);
            }
        },
        [input, streaming, selectedModel, messages, activeChatId]
    );

    const cancel = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const retryLast = useCallback(() => {
        if (streaming || messages.length === 0) return;
        const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
        if (lastUserIndex === -1) return;

        const lastUserContent = messages[lastUserIndex].content;
        setMessages((prev) => prev.slice(0, lastUserIndex));
        send(lastUserContent);
    }, [messages, streaming, send]);

    const deleteMessage = useCallback((id: string) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
    }, []);

    const clearMessages = useCallback(() => {
        setMessages([]);
        setStatusMessage("Conversation cleared.");
        toast.info("Conversation cleared");
    }, []);

    const generateCode = useCallback(
        (lang: ExportLanguage) => {
            return generatePlaygroundCodeSnippet(lang, {
                apiBase,
                modelId: selectedModel?.id ?? "model-id",
                activeChatId,
                messages: requestMessages()
            });
        },
        [selectedModel, messages, apiBase, activeChatId]
    );

    const handleCopyCode = useCallback(async () => {
        const code = generateCode(exportLanguage);
        try {
            await navigator.clipboard.writeText(code);
            setCopiedSnippet(true);
            toast.success("Code snippet copied to clipboard");
            setTimeout(() => setCopiedSnippet(false), 2000);
        } catch {
            toast.error("Failed to copy code snippet");
        }
    }, [generateCode, exportLanguage]);

    return {
        chatId: activeChatId,
        sessions,
        model,
        setModel,
        selectedModel,
        input,
        setInput,
        messages,
        setMessages,
        streaming,
        statusMessage,
        showCodeSheet,
        setShowCodeSheet,
        showHistoryModal,
        setShowHistoryModal,
        thinkingEnabled,
        setThinkingEnabled,
        systemPrompt,
        setSystemPrompt,
        temperature,
        setTemperature,
        maxTokens,
        setMaxTokens,
        exportLanguage,
        setExportLanguage,
        copiedSnippet,
        copiedChatId,
        hasUsableModel,
        lastLatencyMs,
        createSession,
        switchSession,
        deleteSession,
        copyChatId,
        send,
        cancel,
        retryLast,
        deleteMessage,
        clearMessages,
        generateCode,
        handleCopyCode
    };
}
