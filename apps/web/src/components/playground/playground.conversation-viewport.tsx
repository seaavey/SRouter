import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    Bot,
    Check,
    Clock,
    Copy,
    CornerDownLeft,
    Cpu,
    RefreshCw,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Trash2,
    User,
    Zap
} from "lucide-react";
import { MarkdownRenderer } from "./playground.markdown-renderer";
import LoadingState from "./playground.loading-state";
import { ThinkingState } from "./playground.thinking-state";
import type { PlaygroundMessage, PlaygroundModel } from "./playground.types";

interface ConversationViewportProps {
    messages: PlaygroundMessage[];
    selectedModel?: PlaygroundModel;
    streaming: boolean;
    chatId?: string;
    onStarterClick: (prompt: string) => void;
    onRetry: () => void;
    onDeleteMessage: (id: string) => void;
}

export function ConversationViewport({
    messages,
    selectedModel,
    streaming,
    chatId,
    onStarterClick,
    onRetry,
    onDeleteMessage
}: ConversationViewportProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [userScrolledUp, setUserScrolledUp] = useState(false);
    const [canScrollTop, setCanScrollTop] = useState(false);
    const prevMessagesLength = useRef(messages.length);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});

    // Reset userScrolledUp when a new message is added
    useEffect(() => {
        if (messages.length > prevMessagesLength.current) {
            setUserScrolledUp(false);
        }
        prevMessagesLength.current = messages.length;
    }, [messages.length]);

    // Auto-scroll when streaming or new messages arrive, unless user intentionally scrolled up
    useEffect(() => {
        if (!userScrolledUp && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [messages, streaming, userScrolledUp]);

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        // Show scroll-to-top if scrolled down more than 160px
        setCanScrollTop(scrollTop > 160);

        // If user is within 60px from bottom, consider them at bottom
        if (distanceFromBottom > 60) {
            setUserScrolledUp(true);
        } else {
            setUserScrolledUp(false);
        }
    };

    const scrollToTop = () => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        }
    };

    const scrollToBottom = () => {
        setUserScrolledUp(false);
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    };

    const copyToClipboard = async (id: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedMessageId(id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        } catch {
            // fallback ignore
        }
    };

    return (
        <section
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[14px] border-b border-[var(--line)] bg-[var(--canvas)]"
            aria-label="Conversation log"
        >
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"
                role="log"
                aria-busy={streaming}
            >
                {messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center select-none">
                        <div className="flex size-10 items-center justify-center rounded-[12px] bg-[var(--field)] text-[var(--ink-3)] mb-2">
                            <Bot className="size-5 text-[var(--ink)]" />
                        </div>
                        <p className="font-mono text-[13px] font-semibold text-[var(--ink)]">
                            {selectedModel?.id || "SRouter Playground"}
                        </p>
                        <p className="mt-1 max-w-xs font-mono text-[11.5px] text-[var(--ink-3)]">
                            Type a prompt below to start streaming completions.
                        </p>
                    </div>
                ) : (
                    <div className="mx-auto max-w-3xl space-y-5">
                        {messages.map((message, index) => {
                            const isUser = message.role === "user";
                            const isAssistant = message.role === "assistant";
                            const isLastAssistant =
                                isAssistant && index === messages.length - 1 && !streaming;
                            const isGenerating =
                                isAssistant && streaming && index === messages.length - 1;

                            if (isUser) {
                                return (
                                    <div
                                        key={message.id || `msg-${index}`}
                                        className="group flex flex-col items-end gap-1.5 pl-12"
                                    >
                                        <div className="rounded-[14px] bg-[var(--field)] px-4 py-2.5 font-mono text-[12.5px] leading-[1.5] text-[var(--ink)] shadow-xs transition-transform duration-200">
                                            {message.content}
                                        </div>
                                        <div className="flex items-center gap-1.5 pr-1 font-mono text-[10px] text-[var(--ink-3)] opacity-60 transition-opacity group-hover:opacity-100">
                                            <span className="text-[9.5px] font-semibold uppercase tracking-wider">
                                                You
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    copyToClipboard(message.id, message.content)
                                                }
                                                className="flex size-5 items-center justify-center rounded-[4px] text-[var(--ink-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                                title="Copy prompt"
                                                aria-label="Copy prompt"
                                            >
                                                {copiedMessageId === message.id ? (
                                                    <Check className="size-3 text-emerald-500" />
                                                ) : (
                                                    <Copy className="size-3" />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDeleteMessage(message.id)}
                                                className="flex size-5 items-center justify-center rounded-[4px] text-[var(--ink-3)] transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                title="Delete prompt"
                                                aria-label="Delete prompt"
                                            >
                                                <Trash2 className="size-3" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            }

                            // Assistant Message (Beautiful UI layout)
                            return (
                                <div
                                    key={message.id || `msg-${index}`}
                                    className="flex w-full flex-col gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
                                >
                                    {/* Assistant Header */}
                                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
                                        <div className="flex items-center gap-2 text-[12px] leading-[1.3]">
                                            <div className="flex size-5.5 items-center justify-center rounded-[6px] bg-[var(--field)] text-[var(--ink)]">
                                                <Bot className="size-3.5" />
                                            </div>
                                            <span className="font-semibold text-[var(--ink)]">
                                                {selectedModel?.id || "Assistant"}
                                            </span>
                                            <span className="text-[var(--ink-2)] font-mono text-[11px]">
                                                {selectedModel?.owned_by ?? "gateway"}
                                            </span>
                                            {message.durationMs && (
                                                <span className="text-[var(--ink-3)] font-mono text-[10.5px]">
                                                    for {(message.durationMs / 1000).toFixed(1)}s
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                            {!isLastAssistant && message.usage && (
                                                <div className="hidden items-center gap-1.5 rounded-[5px] bg-[var(--field)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-3)] sm:flex">
                                                    <span>↓{message.usage.promptTokens}</span>
                                                    <span>↑{message.usage.completionTokens}</span>
                                                    {message.usage.cachedTokens ? (
                                                        <span className="flex items-center gap-0.5 font-semibold text-emerald-500">
                                                            <Zap className="size-2" />
                                                            <span>
                                                                {message.usage.cachedTokens}
                                                            </span>
                                                        </span>
                                                    ) : null}
                                                </div>
                                            )}
                                            {isLastAssistant && (
                                                <button
                                                    type="button"
                                                    onClick={onRetry}
                                                    className="flex items-center gap-1 rounded-[6px] px-2 py-1 font-mono text-[10.5px] text-[var(--ink-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                                    title="Regenerate response"
                                                >
                                                    <RefreshCw className="size-3" />
                                                    <span className="hidden sm:inline">Retry</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    copyToClipboard(message.id, message.content)
                                                }
                                                className="flex items-center gap-1 rounded-[6px] px-2 py-1 font-mono text-[10.5px] text-[var(--ink-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                                title="Copy markdown"
                                            >
                                                {copiedMessageId === message.id ? (
                                                    <>
                                                        <Check className="size-3 text-emerald-500" />
                                                        <span className="text-emerald-500">
                                                            Copied
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="size-3" />
                                                        <span className="hidden sm:inline">
                                                            Copy
                                                        </span>
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDeleteMessage(message.id)}
                                                className="rounded-[6px] p-1 text-[var(--ink-3)] transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                title="Delete message"
                                            >
                                                <Trash2 className="size-3" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Thinking Trace (Beautiful UI Thinking State) */}
                                    <ThinkingState
                                        variant={
                                            selectedModel?.id?.toLowerCase().includes("code") ||
                                            selectedModel?.id?.toLowerCase().includes("coder")
                                                ? "Coding"
                                                : "Steps"
                                        }
                                        isStreaming={isGenerating && !message.content}
                                        durationMs={message.durationMs}
                                        modelId={selectedModel?.id}
                                    />

                                    {/* Message Body */}
                                    {message.error ? (
                                        <div className="flex items-start gap-2.5 rounded-[8px] border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                                            <AlertCircle className="mt-0.5 size-4 shrink-0" />
                                            <div className="space-y-1.5">
                                                <p className="font-semibold">Generation Error</p>
                                                <p className="font-mono text-[11px] leading-relaxed">
                                                    {message.content}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={onRetry}
                                                    className="inline-flex items-center gap-1 rounded-[6px] border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-destructive hover:bg-destructive/20"
                                                >
                                                    <RefreshCw className="size-2.5" /> Retry Request
                                                </button>
                                            </div>
                                        </div>
                                    ) : isGenerating && !message.content ? (
                                        <LoadingState
                                            label={`Streaming from ${selectedModel?.id || "gateway"}...`}
                                            variant="Drive"
                                            startTime={message.createdAt}
                                        />
                                    ) : (
                                        <div className="text-[13px] leading-relaxed text-[var(--ink)]">
                                            <MarkdownRenderer
                                                content={message.content}
                                                isStreaming={isGenerating}
                                            />
                                        </div>
                                    )}

                                    {/* Beautiful UI Streaming Text Actions & Follow-ups */}
                                    {isLastAssistant && message.content && !message.error && (
                                        <div className="mt-2.5 border-t border-[var(--line)] pt-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setFeedback((prev) => ({
                                                                ...prev,
                                                                [message.id]: "up"
                                                            }))
                                                        }
                                                        className={`flex size-6 items-center justify-center rounded-[6px] transition-colors ${
                                                            feedback[message.id] === "up"
                                                                ? "bg-[var(--hover-2)] text-[var(--ink)]"
                                                                : "text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink-2)]"
                                                        }`}
                                                        title="Good response"
                                                    >
                                                        <ThumbsUp className="size-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setFeedback((prev) => ({
                                                                ...prev,
                                                                [message.id]: "down"
                                                            }))
                                                        }
                                                        className={`flex size-6 items-center justify-center rounded-[6px] transition-colors ${
                                                            feedback[message.id] === "down"
                                                                ? "bg-[var(--hover-2)] text-[var(--ink)]"
                                                                : "text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink-2)]"
                                                        }`}
                                                        title="Bad response"
                                                    >
                                                        <ThumbsDown className="size-3" />
                                                    </button>
                                                </div>

                                                {/* Token Metrics (Prompt in, Completion out, Cache if present) - Hidden on mobile */}
                                                {message.usage && (
                                                    <div className="hidden items-center gap-2 rounded-[6px] bg-[var(--field)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--ink-3)] sm:flex">
                                                        <span title="Input / Prompt Tokens">
                                                            ↓{" "}
                                                            <strong className="font-semibold text-[var(--ink)]">
                                                                {message.usage.promptTokens}
                                                            </strong>{" "}
                                                            in
                                                        </span>
                                                        <span className="text-[var(--line-strong)]">
                                                            ·
                                                        </span>
                                                        <span title="Output / Completion Tokens">
                                                            ↑{" "}
                                                            <strong className="font-semibold text-[var(--ink)]">
                                                                {message.usage.completionTokens}
                                                            </strong>{" "}
                                                            out
                                                        </span>
                                                        {message.usage.cachedTokens ? (
                                                            <>
                                                                <span className="text-[var(--line-strong)]">
                                                                    ·
                                                                </span>
                                                                <span
                                                                    className="flex items-center gap-0.5 font-semibold text-emerald-500"
                                                                    title="Cached Tokens"
                                                                >
                                                                    <Zap className="size-2.5" />
                                                                    <span>
                                                                        {message.usage.cachedTokens}{" "}
                                                                        cached
                                                                    </span>
                                                                </span>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Dynamic AI-Generated Follow-up Prompts */}
                                            {(message.isGeneratingFollowUps ||
                                                (message.followUps &&
                                                    message.followUps.length > 0)) && (
                                                <div className="mt-3 flex flex-col gap-1">
                                                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-3)]">
                                                        <Sparkles className="size-3 text-[var(--ink-2)]" />
                                                        <span>Follow-up actions</span>
                                                    </div>

                                                    {message.isGeneratingFollowUps ? (
                                                        <div className="py-1">
                                                            <LoadingState
                                                                label="Suggesting follow-ups..."
                                                                variant="Dots"
                                                            />
                                                        </div>
                                                    ) : (
                                                        message.followUps?.map((followUp, i) => (
                                                            <button
                                                                key={i}
                                                                type="button"
                                                                onClick={() =>
                                                                    onStarterClick(followUp)
                                                                }
                                                                className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-[var(--line)]/60 px-1.5 py-1.5 text-left text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--hover-2)]"
                                                            >
                                                                <CornerDownLeft className="size-3 shrink-0 text-[var(--ink-3)]" />
                                                                <span>{followUp}</span>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Floating Animated Scroll Navigation buttons (0.7s bounce) */}
            <div className="absolute bottom-4 right-6 z-40 flex items-center gap-2">
                <AnimatePresence>
                    {canScrollTop && messages.length > 0 && (
                        <motion.button
                            key="scroll-to-top-btn"
                            initial={{ opacity: 0, y: 14, scale: 0.88 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 14, scale: 0.88 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.92 }}
                            type="button"
                            onClick={scrollToTop}
                            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 font-mono text-[11px] font-semibold text-[var(--ink)] shadow-card backdrop-blur-md cursor-pointer hover:bg-[var(--hover)] transition-colors"
                            title="Scroll to top"
                        >
                            <motion.span
                                animate={{ y: [0, -2.5, 0] }}
                                transition={{ repeat: Infinity, duration: 0.7, ease: "easeInOut" }}
                            >
                                <ArrowUp className="size-3.5" />
                            </motion.span>
                            <span>Scroll to top</span>
                        </motion.button>
                    )}

                    {userScrolledUp && messages.length > 0 && (
                        <motion.button
                            key="scroll-to-bottom-btn"
                            initial={{ opacity: 0, y: 14, scale: 0.88 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 14, scale: 0.88 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.92 }}
                            type="button"
                            onClick={scrollToBottom}
                            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--ink)] px-3 py-1.5 font-mono text-[11px] font-semibold text-[var(--canvas)] shadow-xl cursor-pointer"
                            title="Scroll to bottom"
                        >
                            <motion.span
                                animate={{ y: [0, 2.5, 0] }}
                                transition={{ repeat: Infinity, duration: 0.7, ease: "easeInOut" }}
                            >
                                <ArrowDown className="size-3.5" />
                            </motion.span>
                            <span>Scroll to bottom</span>
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>
        </section>
    );
}
