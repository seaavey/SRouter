import { useState } from "react";
import { ChevronDown, ChevronUp, Cpu, KeyRound, Network, ShieldCheck, Zap } from "lucide-react";

export function ComboArchitecture() {
    const [expanded, setExpanded] = useState(false);

    return (
        <section className="rounded-xl border border-border/70 bg-card/60 transition-all font-mono text-left">
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between p-3.5 sm:p-4 text-left cursor-pointer hover:bg-secondary/30 transition-colors rounded-xl"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex size-6 items-center justify-center rounded-md bg-secondary text-foreground">
                        <Network className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">
                                Gateway Failover &amp; Cascade Pipeline
                            </span>
                            <span className="rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.2 text-[9px] font-semibold">
                                Zero Downtime
                            </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                            3-layer automated failover protection: Circuit Breaker &bull; Key
                            Rotation &bull; Priority Cascades
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 ml-2">
                    <span className="hidden sm:inline text-[10px]">
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
                <div className="p-4 sm:p-5 border-t border-border/60 grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in-50 duration-200">
                    {/* Layer 1 */}
                    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3.5 flex flex-col justify-between space-y-2.5">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-500">
                                        1
                                    </span>
                                    <span>Key Health Monitor</span>
                                </div>
                                <KeyRound className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                Active circuit breaker tracks per-key health, latency, and cooldown
                                windows to route requests only to responsive keys.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5 w-fit">
                            Per-Key Circuit Breaker
                        </span>
                    </div>

                    {/* Layer 2 */}
                    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3.5 flex flex-col justify-between space-y-2.5">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded-full bg-sky-500/20 text-[9px] font-bold text-sky-500">
                                        2
                                    </span>
                                    <span>Multi-Key Rotation</span>
                                </div>
                                <Cpu className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                If an account hits 429 quota exhaustion, SRouter automatically
                                rotates to the next available connected provider key.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-semibold text-sky-500 bg-sky-500/10 border border-sky-500/20 rounded px-2 py-0.5 w-fit">
                            Transparent Rotation
                        </span>
                    </div>

                    {/* Layer 3 */}
                    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3.5 flex flex-col justify-between space-y-2.5">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                    <span className="flex size-4 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-500">
                                        3
                                    </span>
                                    <span>Model Cascade</span>
                                </div>
                                <Zap className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                When a primary model encounters complete provider downtime, SRouter
                                cascades down your configured combo fallback chain seamlessly.
                            </p>
                        </div>
                        <span className="text-[9.5px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5 w-fit">
                            Cross-Model Fallback
                        </span>
                    </div>
                </div>
            )}
        </section>
    );
}
