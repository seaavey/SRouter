import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    ArrowUp,
    Bot,
    Brain,
    ChevronDown,
    Database,
    FileText,
    Globe,
    Layers,
    MessageSquare,
    Mic,
    Paperclip,
    Sparkles,
    Square,
    Trash2,
    X,
    Zap
} from "lucide-react";
import { ModelPickerDropdown } from "./ModelPickerDropdown";
import { PlaygroundSettingsPopover } from "./PlaygroundSettingsPopover";
import type { PlaygroundModel } from "./types";

interface PromptBarProps {
    input: string;
    model: string;
    models: PlaygroundModel[];
    selectedModel?: PlaygroundModel;
    streaming: boolean;
    hasMessages: boolean;
    onModelChange: (model: string) => void;
    onInputChange: (value: string) => void;
    onSend: () => void;
    onCancel: () => void;
    onOpenHistory: () => void;
    sessionsCount?: number;
    thinkingEnabled?: boolean;
    onToggleThinking?: () => void;
    systemPrompt?: string;
    onSystemPromptChange?: (val: string) => void;
    temperature?: number;
    onTemperatureChange?: (val: number) => void;
    maxTokens?: number;
    onMaxTokensChange?: (val: number) => void;
    onOpenCode?: () => void;
    onClear?: () => void;
    variant?: "Rounded" | "Pill";
}

type Source = {
    key: string;
    name: string;
    desc: string;
    icon: React.ReactNode;
    attach?: boolean;
};

const SOURCES: Source[] = [
    {
        key: "attach",
        name: "Add files & data",
        desc: "Upload text or code context",
        icon: <Paperclip className="size-3.5 text-blue-400" />,
        attach: true
    },
    {
        key: "web",
        name: "@web",
        desc: "Real-time web search and live grounding",
        icon: <Globe className="size-3.5 text-emerald-400" />
    },
    {
        key: "docs",
        name: "@docs",
        desc: "SRouter API documentation & guides",
        icon: <FileText className="size-3.5 text-indigo-400" />
    },
    {
        key: "models",
        name: "@models",
        desc: "Available upstream model benchmarks",
        icon: <Database className="size-3.5 text-amber-400" />
    }
];

const COMMANDS = [
    {
        key: "compare",
        name: "/compare",
        desc: "Compare model latency & token costs",
        icon: <Layers className="size-3.5 text-purple-400" />
    },
    {
        key: "summarize",
        name: "/summarize",
        desc: "Digest and summarize current conversation",
        icon: <Sparkles className="size-3.5 text-amber-400" />
    },
    {
        key: "clear",
        name: "/clear",
        desc: "Clear current chat conversation",
        icon: <Trash2 className="size-3.5 text-rose-400" />
    },
    {
        key: "fast",
        name: "/fast",
        desc: "Switch to highest throughput model",
        icon: <Zap className="size-3.5 text-emerald-400" />
    }
];

const SAMPLE_FILES = ["schema.json", "api-route.ts", "benchmark.csv"];
const DICTATION_SAMPLES = [
    "Compare latency and token pricing between GPT-5 and Claude Sonnet",
    "Explain how SRouter implements zero-latency executor routing",
    "Write a TypeScript client for streaming chat completions"
];

function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
    const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
    if (!match) return null;
    return {
        kind: match[2] === "@" ? "at" : "slash",
        query: match[3].toLowerCase(),
        start: match.index + match[1].length
    };
}

export function PromptBar({
    input,
    model,
    models,
    selectedModel,
    streaming,
    hasMessages,
    onModelChange,
    onInputChange,
    onSend,
    onCancel,
    onOpenHistory,
    sessionsCount,
    thinkingEnabled,
    onToggleThinking,
    systemPrompt = "",
    onSystemPromptChange,
    temperature = 0.7,
    onTemperatureChange,
    maxTokens = 2048,
    onMaxTokensChange,
    onOpenCode,
    onClear,
    variant = "Rounded"
}: PromptBarProps) {
    const pill = variant === "Pill";
    const [dismissed, setDismissed] = useState(false);
    const [plusOpen, setPlusOpen] = useState(false);
    const [modelOpen, setModelOpen] = useState(false);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [active, setActive] = useState(0);
    const [listening, setListening] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
    const [engaged, setEngaged] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const token = dismissed ? null : parseToken(input);
    const menu: "at" | "slash" | null = plusOpen ? "at" : (token?.kind ?? null);
    const query = plusOpen ? "" : (token?.query ?? "");

    const rows = useMemo(() => {
        if (menu === "at") {
            return SOURCES.filter((s) => s.name.toLowerCase().includes(query));
        }
        if (menu === "slash") {
            return COMMANDS.filter((c) => c.name.slice(1).startsWith(query));
        }
        return [];
    }, [menu, query]);

    useEffect(() => {
        setActive(0);
        setEngaged(false);
    }, [menu, query]);

    // Gliding highlight for @ and / menus
    useLayoutEffect(() => {
        const target = rowRefs.current[active];
        if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
    }, [menu, query, active, rows.length]);

    // Close menus on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setPlusOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Voice dictation simulation
    useEffect(() => {
        if (!listening) return;
        const sample = DICTATION_SAMPLES[Math.floor(Math.random() * DICTATION_SAMPLES.length)];
        const timer = setTimeout(() => {
            onInputChange(input ? `${input.trimEnd()} ${sample}` : sample);
            setListening(false);
            inputRef.current?.focus();
        }, 2200);
        return () => clearTimeout(timer);
    }, [listening, input, onInputChange]);

    // Dynamic auto-expansion and height calculation
    useLayoutEffect(() => {
        const inputEl = inputRef.current;
        const measureEl = measureRef.current;
        if (!inputEl || !measureEl) return;

        const needsFull = input.includes("\n") || input.length > 55 || attachments.length > 0;
        if (needsFull !== expanded) {
            setExpanded(needsFull);
        }

        inputEl.style.height = "0px";
        const scrollH = inputEl.scrollHeight;
        const clampedH = Math.min(Math.max(scrollH, 28), 160);
        inputEl.style.height = `${clampedH}px`;
        inputEl.style.overflowY = scrollH > 160 ? "auto" : "hidden";
    }, [input, expanded, attachments.length]);

    // Rainbow canvas sweep trigger
    const playRainbowSweep = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        let start: number | null = null;
        const duration = 850;

        const animate = (timestamp: number) => {
            if (!start) start = timestamp;
            const progress = (timestamp - start) / duration;
            if (progress > 1) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const gradient = ctx.createLinearGradient(
                (progress - 0.4) * canvas.width,
                0,
                (progress + 0.4) * canvas.width,
                0
            );
            gradient.addColorStop(0, "transparent");
            gradient.addColorStop(0.2, "rgba(239, 68, 68, 0.15)");
            gradient.addColorStop(0.4, "rgba(245, 158, 11, 0.2)");
            gradient.addColorStop(0.6, "rgba(16, 185, 129, 0.2)");
            gradient.addColorStop(0.8, "rgba(59, 130, 246, 0.2)");
            gradient.addColorStop(1, "transparent");

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    };

    const handleSelectModel = (m: PlaygroundModel) => {
        onModelChange(m.id);
        setModelOpen(false);
        playRainbowSweep();
    };

    const pickOption = (row: (typeof rows)[number]) => {
        if ("attach" in row && row.attach) {
            setAttachments((prev) => [...prev, SAMPLE_FILES[prev.length % SAMPLE_FILES.length]]);
            if (token) onInputChange(input.slice(0, token.start));
        } else if (row.key === "clear") {
            onClear?.();
            onInputChange("");
        } else if (row.key === "fast") {
            const fastest = models.find(
                (m) =>
                    m.id.toLowerCase().includes("mini") ||
                    m.id.toLowerCase().includes("flash") ||
                    m.id.toLowerCase().includes("luna")
            );
            if (fastest) handleSelectModel(fastest);
            onInputChange("");
        } else if (menu === "at") {
            onInputChange(`${token ? input.slice(0, token.start) : input}@${row.name} `);
        } else {
            onInputChange(`${token ? input.slice(0, token.start) : input}${row.name} `);
        }
        setPlusOpen(false);
        setDismissed(false);
        inputRef.current?.focus();
    };

    const canSend =
        (input.trim().length > 0 || attachments.length > 0) && Boolean(selectedModel || model);

    const handleSendPrompt = () => {
        if (!canSend || streaming) return;
        setAttachments([]);
        onSend();
        playRainbowSweep();
    };

    return (
        <div
            ref={containerRef}
            className="relative z-30 flex shrink-0 flex-col bg-[var(--canvas)] p-2.5 sm:p-3.5"
        >
            {/* Hidden measuring element */}
            <span
                ref={measureRef}
                aria-hidden="true"
                className="pointer-events-none absolute invisible whitespace-pre font-mono text-[13px] leading-[18px]"
            >
                {input}
            </span>

            {/* Anchor container for popups */}
            <div className="relative w-full">
                {/* ── @ / slash command menu ─────────────────────────────── */}
                {menu && (
                    <div
                        onMouseLeave={() => setEngaged(false)}
                        className="absolute inset-x-0 bottom-full z-40 mb-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-2xl backdrop-blur-xl"
                        style={{
                            animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
                            transformOrigin: "bottom center"
                        }}
                    >
                        {/* Gliding highlight */}
                        <span
                            aria-hidden
                            className="pointer-events-none absolute inset-x-1 rounded-[8px] bg-[var(--hover)]"
                            style={{
                                top: rowBox?.top ?? 0,
                                height: rowBox?.height ?? 0,
                                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                                transition:
                                    "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease"
                            }}
                        />
                        {rows.map((row, i) => (
                            <button
                                key={row.key}
                                type="button"
                                ref={(el) => {
                                    rowRefs.current[i] = el;
                                }}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => {
                                    setActive(i);
                                    setEngaged(true);
                                }}
                                onClick={() => pickOption(row)}
                                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left font-mono transition-colors cursor-pointer"
                            >
                                <span className="flex size-5 shrink-0 items-center justify-center">
                                    {row.icon}
                                </span>
                                <span className="shrink-0 text-[12px] font-semibold text-[var(--ink)]">
                                    {row.name}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--ink-3)]">
                                    {row.desc}
                                </span>
                            </button>
                        ))}
                        {rows.length === 0 && (
                            <div className="flex h-9 items-center px-3 font-mono text-[12px] text-[var(--ink-3)]">
                                No matches for “{query}”
                            </div>
                        )}
                        <div className="mt-1 border-t border-[var(--line)] px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] text-[var(--ink-3)]">
                            {menu === "at"
                                ? "Type to search sources & context"
                                : "Type to filter commands"}
                        </div>
                    </div>
                )}

                {/* ── Model Picker Dropdown ─────────────────────────────── */}
                <ModelPickerDropdown
                    isOpen={modelOpen}
                    models={models}
                    currentModel={model}
                    onSelectModel={handleSelectModel}
                    onClose={() => setModelOpen(false)}
                />

                {/* ── Main Composer Container ───────────────────────────── */}
                <div
                    className={`relative isolate flex flex-col gap-1.5 overflow-hidden border border-[var(--line)] bg-[var(--surface)] p-2 shadow-2xl transition-[border-color,border-radius] duration-150 focus-within:border-[var(--line-strong)] ${
                        pill ? "rounded-[24px]" : "rounded-[14px]"
                    }`}
                >
                    {/* Rainbow sweep canvas across interior */}
                    <canvas
                        ref={canvasRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
                        style={{ borderRadius: "inherit" }}
                    />

                    {/* Attachment Chips */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5 px-1">
                            {attachments.map((file, i) => (
                                <span
                                    key={`${file}-${i}`}
                                    className="flex h-6 items-center gap-1.5 rounded-[6px] border border-[var(--line)] bg-[var(--field)] py-0.5 pr-1 pl-2 font-mono text-[10.5px] text-[var(--ink-2)]"
                                    style={{
                                        animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both"
                                    }}
                                >
                                    <Paperclip className="size-3 text-blue-400" />
                                    <span className="max-w-36 truncate">{file}</span>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${file}`}
                                        onClick={() =>
                                            setAttachments((current) =>
                                                current.filter((_, j) => j !== i)
                                            )
                                        }
                                        className="flex size-4 items-center justify-center rounded-[4px] text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer"
                                    >
                                        <X className="size-2.5 stroke-[2.5]" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Input Textarea */}
                    <div className="w-full">
                        <textarea
                            ref={inputRef}
                            rows={1}
                            value={input}
                            onChange={(e) => {
                                onInputChange(e.target.value);
                                setDismissed(false);
                                setPlusOpen(false);
                            }}
                            onKeyDown={(e) => {
                                if (menu && rows.length > 0) {
                                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setEngaged(true);
                                        setActive(
                                            (cur) =>
                                                (cur +
                                                    (e.key === "ArrowDown" ? 1 : rows.length - 1)) %
                                                rows.length
                                        );
                                        return;
                                    }
                                    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                                        e.preventDefault();
                                        pickOption(rows[active]);
                                        return;
                                    }
                                }
                                if (e.key === "Escape") {
                                    setDismissed(true);
                                    setPlusOpen(false);
                                    setModelOpen(false);
                                    return;
                                }
                                if (
                                    e.key === "Enter" &&
                                    !e.shiftKey &&
                                    !e.nativeEvent.isComposing
                                ) {
                                    e.preventDefault();
                                    handleSendPrompt();
                                }
                            }}
                            placeholder={
                                listening
                                    ? "Listening to voice input..."
                                    : "Ask anything, type @ for sources, / for commands..."
                            }
                            aria-label="Prompt message"
                            className="min-h-7 w-full resize-none bg-transparent px-1.5 py-1 font-mono text-[12.5px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none"
                        />
                    </div>

                    {/* Bottom Controls Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[var(--line)]/50">
                        {/* Left Group Controls */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {/* + Sources / Files Button */}
                            <button
                                type="button"
                                aria-label="Add sources and files"
                                onClick={() => {
                                    setModelOpen(false);
                                    setPlusOpen((cur) => !cur);
                                    inputRef.current?.focus();
                                }}
                                className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] border transition-colors cursor-pointer ${
                                    plusOpen
                                        ? "border-[var(--line-strong)] bg-[var(--hover)] text-[var(--ink)]"
                                        : "border-transparent bg-[var(--field)] text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                }`}
                                title="Attach context or type @"
                            >
                                <span className="font-mono text-sm leading-none">+</span>
                            </button>

                            {/* Model Selector Pill */}
                            <button
                                type="button"
                                onClick={() => {
                                    setPlusOpen(false);
                                    setModelOpen((cur) => !cur);
                                }}
                                className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-[var(--field)] px-2 font-mono text-[11px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--hover)] cursor-pointer"
                                title="Switch active model"
                            >
                                <Bot className="size-3 text-[var(--ink-3)] shrink-0" />
                                <span className="max-w-[130px] sm:max-w-[170px] truncate">
                                    {selectedModel?.id || model || "Select model"}
                                </span>
                                <ChevronDown className="size-3 text-[var(--ink-3)] shrink-0" />
                            </button>

                            {/* Chat History */}
                            <button
                                type="button"
                                onClick={onOpenHistory}
                                className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-[var(--field)] px-2 font-mono text-[11px] text-[var(--ink-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer"
                                title="Conversation History & Saved Sessions"
                            >
                                <MessageSquare className="size-3 text-[var(--ink-3)]" />
                                <span className="hidden sm:inline">History</span>
                                {sessionsCount && sessionsCount > 1 ? (
                                    <span className="ml-0.5 rounded-full bg-[var(--line-strong)] px-1.5 py-0.2 text-[9px] font-bold text-[var(--canvas)]">
                                        {sessionsCount}
                                    </span>
                                ) : null}
                            </button>

                            {/* Thinking Toggle with Rotating Conic Border */}
                            <button
                                type="button"
                                onClick={onToggleThinking}
                                className="relative flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] p-[1px] font-mono text-[11px] transition-all cursor-pointer select-none"
                                title={
                                    thinkingEnabled
                                        ? "Thinking mode active (model outputs reasoning trace)"
                                        : "Click to enable thinking mode"
                                }
                            >
                                {thinkingEnabled ? (
                                    <>
                                        <span
                                            aria-hidden="true"
                                            className="absolute inset-[-200%] animate-[spin_2.5s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0_240deg,#f59e0b_360deg)]"
                                        />
                                        <span className="relative flex h-full w-full items-center gap-1.5 rounded-[7px] bg-[var(--surface)] px-2.5 font-semibold text-amber-500 shadow-xs">
                                            <Brain className="size-3 text-amber-500" />
                                            <span>Think</span>
                                            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                        </span>
                                    </>
                                ) : (
                                    <span className="flex h-full w-full items-center gap-1.5 rounded-[8px] bg-[var(--field)] px-2.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink-2)]">
                                        <Brain className="size-3 text-[var(--ink-3)]" />
                                        <span>Think</span>
                                    </span>
                                )}
                            </button>

                            {/* Playground Settings Popover (3 dots) */}
                            {onSystemPromptChange &&
                                onTemperatureChange &&
                                onMaxTokensChange &&
                                onOpenCode &&
                                onClear && (
                                    <PlaygroundSettingsPopover
                                        systemPrompt={systemPrompt}
                                        onSystemPromptChange={onSystemPromptChange}
                                        temperature={temperature}
                                        onTemperatureChange={onTemperatureChange}
                                        maxTokens={maxTokens}
                                        onMaxTokensChange={onMaxTokensChange}
                                        onOpenCode={onOpenCode}
                                        onClear={onClear}
                                        hasMessages={hasMessages}
                                    />
                                )}
                        </div>

                        {/* Right Group: Dictation + Send/Stop */}
                        <div className="flex items-center gap-1.5">
                            {/* Voice Dictation Button */}
                            <button
                                type="button"
                                aria-label={listening ? "Stop dictation" : "Start dictation"}
                                aria-pressed={listening}
                                onClick={() => setListening((cur) => !cur)}
                                className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-all cursor-pointer ${
                                    listening
                                        ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                                        : "bg-[var(--field)] text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                }`}
                                title={listening ? "Listening... click to stop" : "Voice dictation"}
                            >
                                {listening ? (
                                    <span className="flex h-3 items-center gap-[2.5px]">
                                        {[0, 1, 2].map((i) => (
                                            <span
                                                key={i}
                                                className="w-[2.5px] rounded-full bg-current"
                                                style={{
                                                    height: "100%",
                                                    animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite`
                                                }}
                                            />
                                        ))}
                                    </span>
                                ) : (
                                    <Mic className="size-3.5" />
                                )}
                            </button>

                            {/* Submit / Stop Action */}
                            {streaming ? (
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    className="flex h-7 items-center gap-1.5 rounded-[8px] bg-destructive px-3 font-mono text-[11px] font-semibold text-destructive-foreground transition-transform active:scale-[0.94] cursor-pointer"
                                    title="Stop generation"
                                >
                                    <Square className="size-3 fill-current" />
                                    <span>Stop</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleSendPrompt}
                                    disabled={!canSend}
                                    className="flex size-7 items-center justify-center rounded-[8px] bg-[var(--ink)] text-[var(--canvas)] shadow-xs transition-[transform,opacity] duration-150 enabled:active:scale-[0.94] disabled:opacity-35 cursor-pointer"
                                    title="Send prompt (Enter ↵)"
                                >
                                    <ArrowUp className="size-3.5 stroke-[2.5]" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PromptBar;
