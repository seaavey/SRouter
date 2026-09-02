import { useState } from "react";
import {
    Check,
    ChevronDown,
    ChevronUp,
    Copy,
    ExternalLink,
    Eye,
    Flame,
    MessageSquareX,
    ShieldCheck,
    Sparkles
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { CompressLlmOutputSettings, LazySeniorDevSettings } from "@srouter/types";

interface PromptOptimizerCardProps {
    lazySettings: LazySeniorDevSettings;
    terseSettings: CompressLlmOutputSettings;
    saving: boolean;
    onLazyChange: (settings: Partial<LazySeniorDevSettings>) => void;
    onTerseChange: (settings: Partial<CompressLlmOutputSettings>) => void;
}

export function PromptOptimizerCard({
    lazySettings,
    terseSettings,
    saving,
    onLazyChange,
    onTerseChange
}: PromptOptimizerCardProps) {
    const isLazyActive = lazySettings.enabled;
    const isTerseActive = terseSettings.enabled;
    const [showPromptInspector, setShowPromptInspector] = useState(false);
    const [copied, setCopied] = useState(false);

    // Build synthesized preview prompt
    const parts: string[] = [];
    if (isLazyActive) {
        if (lazySettings.mode === "strict") {
            parts.push(
                `[SYSTEM INSTRUCTION: STRICT MINIMALIST SENIOR DEV]\n` +
                    `- Strictly adhere to YAGNI: Reject all premature abstractions and helper functions.\n` +
                    `- Reuse stdlib & existing utilities: Use only built-in standard libraries. Never add new dependencies.\n` +
                    `- Surgical edits: Make minimal in-place edits. Delete dead code over adding wrappers.\n` +
                    (lazySettings.customInstructions
                        ? `- ${lazySettings.customInstructions}\n`
                        : "")
            );
        } else {
            parts.push(
                `[SYSTEM INSTRUCTION: LAZY SENIOR DEV]\n` +
                    `- YAGNI principle: Keep code minimal, direct, and free of speculative extensibility.\n` +
                    `- Reuse existing stdlib and project utilities rather than importing new packages.\n` +
                    `- Favor deletion/simplification over addition. Output only targeted, necessary changes.\n` +
                    (lazySettings.customInstructions
                        ? `- ${lazySettings.customInstructions}\n`
                        : "")
            );
        }
    }

    if (isTerseActive) {
        if (terseSettings.mode === "ultra_terse") {
            parts.push(
                `[SYSTEM INSTRUCTION: ULTRA TERSE / CAVEMAN OUTPUT]\n` +
                    `- Zero conversational pleasantries, preambles, summaries, or sign-offs.\n` +
                    `- Telegraphic style: direct, concise, high information density.\n` +
                    `- Provide code and direct answers immediately (~80% fewer output tokens).\n` +
                    (terseSettings.customPrompt ? `- ${terseSettings.customPrompt}\n` : "")
            );
        } else {
            parts.push(
                `[SYSTEM INSTRUCTION: TERSE OUTPUT MODE]\n` +
                    `- Eliminate conversational fluff, redundant greetings, and conclusion summaries.\n` +
                    `- Go directly to the solution and code changes with maximum clarity.\n` +
                    (terseSettings.customPrompt ? `- ${terseSettings.customPrompt}\n` : "")
            );
        }
    }

    const synthesizedPrompt =
        parts.length > 0
            ? parts.join("\n\n").trim()
            : "// Both prompt optimization modules are currently disabled (no prompt injection).";

    const handleCopyPrompt = async () => {
        await navigator.clipboard.writeText(synthesizedPrompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-5 shadow-2xs font-mono transition-all">
            <div className="space-y-5">
                {/* Module Header */}
                <div className="flex items-center justify-between pb-3.5 border-b border-border/60">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-secondary/50 text-foreground">
                            <Sparkles className="size-3.5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                    Prompt Biasing &amp; Terse Output
                                </h2>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Injects lean senior developer guidelines and eliminates
                                conversational fluff.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Section 1: Lazy Senior Dev (Ponytail) */}
                <div className="space-y-3 p-3.5 rounded-lg border border-border/60 bg-secondary/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="size-4 text-muted-foreground" />
                            <div>
                                <a
                                    href="https://github.com/DietrichGebert/ponytail"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group inline-flex items-center gap-1 text-xs font-bold text-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                                    title="Visit ponytail on GitHub"
                                >
                                    <span>Lazy Senior Dev Mode (YAGNI)</span>
                                    <ExternalLink className="size-2.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                </a>
                                <span className="text-[10.5px] text-muted-foreground block">
                                    Enforces stdlib reuse, deletion over addition, and minimal code
                                    diffs.
                                </span>
                            </div>
                        </div>

                        <Switch
                            checked={lazySettings.enabled}
                            onCheckedChange={(enabled) => onLazyChange({ enabled })}
                            disabled={saving}
                        />
                    </div>

                    {/* Mode Segmented Controls */}
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg border border-border/80 bg-muted/40 text-xs">
                        <button
                            type="button"
                            onClick={() => onLazyChange({ mode: "balanced" })}
                            disabled={saving || !isLazyActive}
                            className={`rounded-md py-1 px-2 text-[11px] font-semibold transition-all cursor-pointer text-center ${
                                lazySettings.mode === "balanced"
                                    ? "bg-background text-foreground shadow-2xs border border-border/80 font-bold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                            } ${!isLazyActive ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                            Balanced Dev
                        </button>

                        <button
                            type="button"
                            onClick={() => onLazyChange({ mode: "strict" })}
                            disabled={saving || !isLazyActive}
                            className={`rounded-md py-1 px-2 text-[11px] font-semibold transition-all cursor-pointer text-center ${
                                lazySettings.mode === "strict"
                                    ? "bg-background text-foreground shadow-2xs border border-border/80 font-bold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                            } ${!isLazyActive ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                            Strict Minimalist
                        </button>
                    </div>

                    {/* Custom guidance input */}
                    <input
                        type="text"
                        value={lazySettings.customInstructions || ""}
                        onChange={(e) => onLazyChange({ customInstructions: e.target.value })}
                        disabled={saving || !isLazyActive}
                        placeholder="Additional rules: e.g. Prefer native fetch, max 40 lines per function..."
                        className="w-full text-xs font-mono rounded-md border border-border/80 bg-background/80 px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
                    />
                </div>

                {/* Section 2: Compress LLM Output (Caveman) */}
                <div className="space-y-3 p-3.5 rounded-lg border border-border/60 bg-secondary/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Flame className="size-4 text-muted-foreground" />
                            <div>
                                <a
                                    href="https://github.com/JuliusBrussee/caveman"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group inline-flex items-center gap-1 text-xs font-bold text-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                                    title="Visit caveman on GitHub"
                                >
                                    <span>Compress LLM Output (Caveman)</span>
                                    <ExternalLink className="size-2.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                </a>
                                <span className="text-[10.5px] text-muted-foreground block">
                                    Eliminates conversational pleasantries, preambles, and filler
                                    summaries.
                                </span>
                            </div>
                        </div>

                        <Switch
                            checked={terseSettings.enabled}
                            onCheckedChange={(enabled) => onTerseChange({ enabled })}
                            disabled={saving}
                        />
                    </div>

                    {/* Mode Segmented Controls */}
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg border border-border/80 bg-muted/40 text-xs">
                        <button
                            type="button"
                            onClick={() => onTerseChange({ mode: "terse" })}
                            disabled={saving || !isTerseActive}
                            className={`rounded-md py-1 px-2 text-[11px] font-semibold transition-all cursor-pointer text-center ${
                                terseSettings.mode === "terse"
                                    ? "bg-background text-foreground shadow-2xs border border-border/80 font-bold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                            } ${!isTerseActive ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                            Terse (~65%)
                        </button>

                        <button
                            type="button"
                            onClick={() => onTerseChange({ mode: "ultra_terse" })}
                            disabled={saving || !isTerseActive}
                            className={`rounded-md py-1 px-2 text-[11px] font-semibold transition-all cursor-pointer text-center ${
                                terseSettings.mode === "ultra_terse"
                                    ? "bg-background text-foreground shadow-2xs border border-border/80 font-bold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                            } ${!isTerseActive ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                            Caveman (87%)
                        </button>
                    </div>

                    {/* Strip Pleasantries inline toggle */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2">
                            <MessageSquareX className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="text-[11px] text-foreground font-semibold">
                                Strip Greetings &amp; Chat Sign-Offs
                            </span>
                        </div>
                        <Switch
                            checked={terseSettings.stripPleasantries}
                            onCheckedChange={(stripPleasantries) =>
                                onTerseChange({ stripPleasantries })
                            }
                            disabled={saving || !isTerseActive}
                        />
                    </div>
                </div>

                {/* Unified Injected System Prompt Inspector */}
                <div className="rounded-lg border border-border/60 bg-background/50 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setShowPromptInspector(!showPromptInspector)}
                        className="w-full flex items-center justify-between p-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-secondary/30"
                    >
                        <div className="flex items-center gap-2">
                            <Eye className="size-3.5" />
                            <span className="font-semibold text-foreground text-[11px]">
                                Injected System Prompt Preview
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                (~{Math.ceil(synthesizedPrompt.length / 4)} tokens)
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {showPromptInspector ? (
                                <ChevronUp className="size-3.5" />
                            ) : (
                                <ChevronDown className="size-3.5" />
                            )}
                        </div>
                    </button>

                    {showPromptInspector && (
                        <div className="p-3 border-t border-border/60 space-y-2">
                            <div className="flex items-center justify-between text-[10.5px]">
                                <span className="text-muted-foreground">
                                    Synthesized instruction injected into upstream requests:
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCopyPrompt}
                                    className="hover:text-foreground inline-flex items-center gap-1 cursor-pointer transition-colors text-muted-foreground"
                                >
                                    {copied ? (
                                        <Check className="size-3 text-emerald-500" />
                                    ) : (
                                        <Copy className="size-3" />
                                    )}
                                    <span>{copied ? "Copied!" : "Copy"}</span>
                                </button>
                            </div>
                            <pre className="max-h-36 p-2.5 rounded-md border border-border/60 bg-background text-[10.5px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap leading-relaxed">
                                {synthesizedPrompt}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
