import { Link } from "@tanstack/react-router";
import { Bot, Check, Copy, Cpu, Play, Sparkles, Zap } from "lucide-react";
import type { ModelObject } from "@srouter/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCopy } from "@/hooks/useCopy";
import { getProviderBadgeColor, providerFor } from "./model-utils";

export function ModelCard({ model }: { model: ModelObject }) {
    const { copied, copy } = useCopy();
    const provider = providerFor(model);
    const badgeColorClass = getProviderBadgeColor(provider);

    return (
        <Card className="p-4 border border-border/70 bg-card hover:border-foreground/30 transition-all hover:shadow-xs flex flex-col justify-between gap-3">
            <div>
                {/* Header: Model ID + Provider Badge */}
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded border border-border/60 bg-secondary/30 text-foreground">
                            <Bot className="size-3.5 text-muted-foreground" />
                        </div>
                        <span
                            className="font-mono text-xs font-semibold text-foreground truncate block min-w-0 flex-1"
                            title={model.id}
                        >
                            {model.id}
                        </span>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                void copy(model.id);
                            }}
                            className="text-muted-foreground hover:text-foreground p-1 transition-colors rounded hover:bg-secondary shrink-0"
                            title="Copy Model ID"
                        >
                            {copied === model.id ? (
                                <Check className="size-3 text-emerald-500" />
                            ) : (
                                <Copy className="size-3" />
                            )}
                        </button>
                    </div>

                    <Badge
                        variant="outline"
                        className={`font-mono text-[10px] font-semibold uppercase px-2 py-0.5 border ${badgeColorClass} shrink-0`}
                    >
                        {provider}
                    </Badge>
                </div>

                {/* Capabilities & Metadata */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-secondary/30 px-2 py-0.5 font-mono text-[10px] text-foreground">
                        <Sparkles className="size-3 text-amber-500" />
                        Chat Completion
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-secondary/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        <Zap className="size-3 text-emerald-500" />
                        Streaming
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-secondary/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        <Cpu className="size-3 text-sky-500" />
                        Function Call
                    </span>
                </div>
            </div>

            {/* Footer: Status + Test Action */}
            <div className="pt-2.5 border-t border-border/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[10px]">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span>Active</span>
                </div>

                <Link
                    to="/playground"
                    search={{ model: model.id }}
                    className="inline-flex items-center gap-1 rounded bg-secondary hover:bg-foreground hover:text-background px-2.5 py-1 text-xs font-semibold text-foreground transition-all active:scale-95 border border-border/60"
                >
                    <Play className="size-3" />
                    <span>Test</span>
                </Link>
            </div>
        </Card>
    );
}
