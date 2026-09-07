import { useState } from "react";
import { ChevronDown, ChevronUp, Cpu, KeyRound, Network, Zap } from "lucide-react";

export function ComboArchitecture() {
    const [expanded, setExpanded] = useState(false);

    return (
        <section className="rounded-lg border border-border/80 bg-card/60 transition-all font-mono text-left shadow-2xs">
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between p-3 sm:p-3.5 text-left cursor-pointer hover:bg-secondary/40 transition-colors rounded-lg"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex size-6 items-center justify-center rounded border border-border/80 bg-secondary text-foreground">
                        <Network className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">
                                Gateway Failover &amp; Cascade Architecture
                            </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                            3-layer automated failover: Circuit Breaker &bull; Key Rotation &bull; Priority Cascades
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 ml-2 font-mono">
                    <span className="hidden sm:inline text-[10px]">
                        {expanded ? "Hide Details" : "How It Works"}
                    </span>
                    {expanded ? (
                        <ChevronUp className="size-3.5" />
                    ) : (
                        <ChevronDown className="size-3.5" />
                    )}
                </div>
            </button>

            {expanded && (
                <div className="p-4 border-t border-border/70 grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in-50 duration-150">
                    {/* Layer 1 */}
                    <div className="rounded border border-border/70 bg-card p-3 flex flex-col justify-between space-y-2">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded border border-border/80 bg-secondary text-[9px] font-bold text-foreground">
                                        1
                                    </span>
                                    <span>Key Circuit Breaker</span>
                                </div>
                                <KeyRound className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                Tracks per-key response health, latency anomalies, and cooldown windows to quarantine failing keys.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-medium text-muted-foreground bg-secondary/60 border border-border/60 rounded px-1.5 py-0.2 w-fit">
                            Per-Key Breaker
                        </span>
                    </div>

                    {/* Layer 2 */}
                    <div className="rounded border border-border/70 bg-card p-3 flex flex-col justify-between space-y-2">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded border border-border/80 bg-secondary text-[9px] font-bold text-foreground">
                                        2
                                    </span>
                                    <span>Multi-Key Rotation</span>
                                </div>
                                <Cpu className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                On 429 quota exhaustion, SRouter automatically rotates to the next available connected account key.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-medium text-muted-foreground bg-secondary/60 border border-border/60 rounded px-1.5 py-0.2 w-fit">
                            Transparent Rotation
                        </span>
                    </div>

                    {/* Layer 3 */}
                    <div className="rounded border border-border/70 bg-card p-3 flex flex-col justify-between space-y-2">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded border border-border/80 bg-secondary text-[9px] font-bold text-foreground">
                                        3
                                    </span>
                                    <span>Model Cascade</span>
                                </div>
                                <Zap className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                If all keys for a model exhaust or return 5xx errors, SRouter transparently cascades to your backup model.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-medium text-muted-foreground bg-secondary/60 border border-border/60 rounded px-1.5 py-0.2 w-fit">
                            Priority Sequence
                        </span>
                    </div>
                </div>
            )}
        </section>
    );
}
