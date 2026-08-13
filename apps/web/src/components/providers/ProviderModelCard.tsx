import { Link } from "@tanstack/react-router";
import { Bot, Check, Copy, Play, Sparkles, Zap } from "lucide-react";
import type { ModelObject } from "@srouter/types";

interface ProviderModelCardProps {
    model: ModelObject;
    copied: boolean;
    onCopy: (modelId: string) => void;
}

export function ProviderModelCard({ model, copied, onCopy }: ProviderModelCardProps) {
    return (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card p-4 hover:border-foreground/30 transition-all hover:shadow-2xs">
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Bot className="size-4 text-muted-foreground shrink-0" />
                        <span
                            className="font-mono text-xs font-semibold text-foreground truncate block flex-1"
                            title={model.id}
                        >
                            {model.id}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => onCopy(model.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary shrink-0"
                        title="Copy Model ID"
                    >
                        {copied ? (
                            <Check className="size-3 text-emerald-500" />
                        ) : (
                            <Copy className="size-3" />
                        )}
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-secondary/30 px-2 py-0.5 font-mono text-[10px] text-foreground">
                        <Sparkles className="size-3 text-amber-500" />
                        Chat Completion
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-secondary/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        <Zap className="size-3 text-emerald-500" />
                        Streaming
                    </span>
                </div>
            </div>

            <div className="pt-2.5 border-t border-border/50 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-500 font-mono text-[10px]">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span>Active</span>
                </span>

                <Link
                    to="/playground"
                    search={{ model: model.id }}
                    className="inline-flex items-center gap-1 rounded bg-secondary hover:bg-foreground hover:text-background px-2.5 py-1 text-xs font-semibold text-foreground transition-all border border-border/60"
                >
                    <Play className="size-3" />
                    <span>Test</span>
                </Link>
            </div>
        </div>
    );
}
