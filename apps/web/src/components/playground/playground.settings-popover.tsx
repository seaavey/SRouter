import React, { useState, useRef, useEffect } from "react";
import {
    Code2,
    MoreHorizontal,
    RotateCcw,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X
} from "lucide-react";

interface PlaygroundSettingsPopoverProps {
    systemPrompt: string;
    onSystemPromptChange: (value: string) => void;
    temperature: number;
    onTemperatureChange: (value: number) => void;
    maxTokens: number;
    onMaxTokensChange: (value: number) => void;
    onOpenCode: () => void;
    onClear: () => void;
    hasMessages: boolean;
}

const PRESETS = [
    {
        label: "Default",
        prompt: ""
    },
    {
        label: "Senior Dev",
        prompt: "You are a senior full-stack software engineer. Provide clean, modular, production-ready TypeScript/Go code with minimal fluff."
    },
    {
        label: "JSON Output",
        prompt: "You are a specialized data extractor. Always respond with raw, valid JSON only. Do not include markdown codeblocks or explanatory text."
    },
    {
        label: "Concise",
        prompt: "Be extremely concise, direct, and avoid polite conversational filler. Answer with bullet points and code."
    }
];

export function PlaygroundSettingsPopover({
    systemPrompt,
    onSystemPromptChange,
    temperature,
    onTemperatureChange,
    maxTokens,
    onMaxTokensChange,
    onOpenCode,
    onClear,
    hasMessages
}: PlaygroundSettingsPopoverProps) {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close popover when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const hasCustomSettings =
        Boolean(systemPrompt.trim()) || temperature !== 0.7 || maxTokens !== 2048;

    const handleReset = () => {
        onSystemPromptChange("");
        onTemperatureChange(0.7);
        onMaxTokensChange(2048);
    };

    return (
        <div ref={popoverRef} className="relative inline-block">
            {/* Trigger: 3 dots button */}
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className={`relative flex h-7 size-7 items-center justify-center rounded-[8px] border transition-all cursor-pointer ${
                    isOpen || hasCustomSettings
                        ? "border-[var(--line-strong)] bg-[var(--field)] text-[var(--ink)] shadow-xs"
                        : "border-transparent bg-[var(--field)] text-[var(--ink-3)] hover:border-[var(--line)] hover:bg-[var(--hover)] hover:text-[var(--ink-2)]"
                }`}
                title="Playground settings (System prompt, temperature, parameters)"
            >
                <MoreHorizontal className="size-3.5" />
                {hasCustomSettings && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-[var(--surface)]" />
                )}
            </button>

            {/* Popover Dropdown Panel */}
            {isOpen && (
                <div className="absolute bottom-full mb-2 -left-16 sm:left-0 z-50 w-80 sm:w-96 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
                        <div className="flex items-center gap-1.5 font-mono text-[12px] font-bold text-[var(--ink)]">
                            <SlidersHorizontal className="size-3.5 text-[var(--ink)]" />
                            <span>Playground Settings</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                            {hasCustomSettings && (
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    className="flex items-center gap-1 font-mono text-[10px] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                                    title="Reset settings to default"
                                >
                                    <RotateCcw className="size-2.5" />
                                    <span>Reset</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="rounded-[6px] p-1 text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    </div>

                    <div className="mt-3 space-y-3.5">
                        {/* System Prompt Section */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[11px] font-semibold text-[var(--ink)]">
                                <label
                                    htmlFor="system-prompt-input"
                                    className="flex items-center gap-1"
                                >
                                    <Sparkles className="size-3 text-amber-500" />
                                    <span>System Prompt</span>
                                </label>
                                <span className="text-[10px] text-[var(--ink-3)] font-normal">
                                    {systemPrompt.length} chars
                                </span>
                            </div>

                            <textarea
                                id="system-prompt-input"
                                rows={3}
                                value={systemPrompt}
                                onChange={(e) => onSystemPromptChange(e.target.value)}
                                placeholder="Give the model behavioral instructions, persona, or output format constraints..."
                                className="w-full resize-none rounded-[8px] border border-[var(--line)] bg-[var(--canvas)] p-2 font-mono text-[11.5px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--line-strong)] focus:outline-none"
                            />

                            {/* Preset Pills */}
                            <div className="flex flex-wrap gap-1 pt-0.5">
                                {PRESETS.map((preset) => {
                                    const isSelected = systemPrompt === preset.prompt;
                                    return (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => onSystemPromptChange(preset.prompt)}
                                            className={`rounded-[6px] border px-2 py-0.5 font-mono text-[10px] transition-colors cursor-pointer ${
                                                isSelected
                                                    ? "border-[var(--line-strong)] bg-[var(--ink)] text-[var(--canvas)] font-semibold"
                                                    : "border-[var(--line)]/60 bg-[var(--field)] text-[var(--ink-2)] hover:border-[var(--line)] hover:text-[var(--ink)]"
                                            }`}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Parameters: Temperature & Max Tokens */}
                        <div className="space-y-2.5 rounded-[10px] border border-[var(--line)]/60 bg-[var(--field)] p-2.5">
                            {/* Temperature */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                    <span className="font-semibold text-[var(--ink)]">
                                        Temperature
                                    </span>
                                    <span className="font-bold text-[var(--ink)]">
                                        {temperature.toFixed(2)}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0.0"
                                    max="2.0"
                                    step="0.05"
                                    value={temperature}
                                    onChange={(e) =>
                                        onTemperatureChange(parseFloat(e.target.value))
                                    }
                                    className="w-full accent-[var(--ink)] cursor-pointer"
                                />
                                <div className="flex justify-between text-[9.5px] font-mono text-[var(--ink-3)]">
                                    <span>0.0 (Precise)</span>
                                    <span>1.0 (Balanced)</span>
                                    <span>2.0 (Creative)</span>
                                </div>
                            </div>

                            {/* Max Tokens Limit */}
                            <div className="space-y-1 pt-1 border-t border-[var(--line)]/40">
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                    <span className="font-semibold text-[var(--ink)]">
                                        Max Output Tokens
                                    </span>
                                    <span className="font-bold text-[var(--ink)]">{maxTokens}</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1">
                                    {[1024, 2048, 4096, 8192].map((tokens) => (
                                        <button
                                            key={tokens}
                                            type="button"
                                            onClick={() => onMaxTokensChange(tokens)}
                                            className={`rounded-[6px] border py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                                                maxTokens === tokens
                                                    ? "border-[var(--line-strong)] bg-[var(--ink)] text-[var(--canvas)] font-bold"
                                                    : "border-[var(--line)]/60 bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--line)] hover:text-[var(--ink)]"
                                            }`}
                                        >
                                            {tokens}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Quick Utility Actions (Export Code & Clear) */}
                        <div className="flex items-center gap-1.5 pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    onOpenCode();
                                    setIsOpen(false);
                                }}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] py-1.5 font-mono text-[11px] font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer"
                            >
                                <Code2 className="size-3 text-[var(--ink-3)]" />
                                <span>Export Code</span>
                            </button>

                            {hasMessages && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClear();
                                        setIsOpen(false);
                                    }}
                                    className="flex items-center justify-center gap-1.5 rounded-[8px] border border-destructive/20 bg-destructive/5 px-3 py-1.5 font-mono text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15 cursor-pointer"
                                    title="Clear current conversation"
                                >
                                    <Trash2 className="size-3" />
                                    <span>Clear</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
