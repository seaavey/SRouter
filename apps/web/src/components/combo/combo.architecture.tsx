import { useState } from "react";
import { ChevronDown, ChevronUp, Cpu, KeyRound, Network, Zap } from "lucide-react";

export function ComboArchitecture() {
    const [expanded, setExpanded] = useState(false);

    return (
        <section className="rounded-3xl border border-hairline-soft bg-canvas transition-colors font-sans text-left shadow-none hover:border-hairline">
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between p-5 text-left cursor-pointer hover:bg-canvas-soft/40 transition-colors rounded-3xl"
            >
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline-soft bg-canvas-soft text-ink">
                        <Network className="size-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink font-sans">
                                Gateway Failover &amp; Cascade Architecture
                            </span>
                        </div>
                        <p className="text-xs text-text-muted font-sans font-light truncate mt-0.5">
                            3-layer automated failover: Circuit Breaker &bull; Key Rotation &bull;
                            Priority Cascades
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-text-muted shrink-0 ml-3 font-sans">
                    <span className="hidden sm:inline text-xs font-medium">
                        {expanded ? "Hide Details" : "How It Works"}
                    </span>
                    {expanded ? (
                        <ChevronUp className="size-4" />
                    ) : (
                        <ChevronDown className="size-4" />
                    )}
                </div>
            </button>

            {expanded && (
                <div className="p-6 border-t border-hairline-soft grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in-50 duration-150 font-sans">
                    <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-5 flex flex-col justify-between space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                                    <span className="flex size-5 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-[10px] font-bold text-ink font-mono">
                                        1
                                    </span>
                                    <span>Key Circuit Breaker</span>
                                </div>
                                <KeyRound className="size-3.5 text-text-muted" />
                            </div>
                            <p className="text-xs text-text-muted font-sans font-light leading-relaxed">
                                Tracks per-key response health, latency anomalies, and cooldown
                                windows to quarantine failing keys.
                            </p>
                        </div>
                        <span className="text-[10px] font-mono font-medium text-text-muted bg-canvas border border-hairline-soft rounded-full px-2.5 py-0.5 w-fit">
                            Per-Key Breaker
                        </span>
                    </div>
                    <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-5 flex flex-col justify-between space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                                    <span className="flex size-5 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-[10px] font-bold text-ink font-mono">
                                        2
                                    </span>
                                    <span>Multi-Key Rotation</span>
                                </div>
                                <Cpu className="size-3.5 text-text-muted" />
                            </div>
                            <p className="text-xs text-text-muted font-sans font-light leading-relaxed">
                                On 429 quota exhaustion, SRouter automatically rotates to the next
                                available connected account key.
                            </p>
                        </div>
                        <span className="text-[10px] font-mono font-medium text-text-muted bg-canvas border border-hairline-soft rounded-full px-2.5 py-0.5 w-fit">
                            Transparent Rotation
                        </span>
                    </div>
                    <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-5 flex flex-col justify-between space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                                    <span className="flex size-5 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-[10px] font-bold text-ink font-mono">
                                        3
                                    </span>
                                    <span>Model Cascade</span>
                                </div>
                                <Zap className="size-3.5 text-accent" />
                            </div>
                            <p className="text-xs text-text-muted font-sans font-light leading-relaxed">
                                If all keys for a model exhaust or return 5xx errors, SRouter
                                transparently cascades to your backup model.
                            </p>
                        </div>
                        <span className="text-[10px] font-mono font-medium text-text-muted bg-canvas border border-hairline-soft rounded-full px-2.5 py-0.5 w-fit">
                            Priority Sequence
                        </span>
                    </div>
                </div>
            )}
        </section>
    );
}
