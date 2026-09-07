import { Bot, Check, Copy, Star, Trash2 } from "lucide-react";
import type { ModelObject } from "@srouter/types";
import { useFavorites } from "@/hooks/useFavorites";

interface ProviderModelCardProps {
    model: ModelObject;
    copied: boolean;
    onCopy: (modelId: string) => void;
    onDelete?: (modelId: string) => void;
}

export function ProviderModelCard({ model, copied, onCopy, onDelete }: ProviderModelCardProps) {
    const { isFavorite, toggleFavorite } = useFavorites();
    const isFav = isFavorite(model.id);

    return (
        <div
            className={`group flex flex-col justify-between gap-3 rounded-lg border bg-card p-3.5 transition-all duration-150 shadow-2xs font-mono ${
                isFav
                    ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                    : "border-border/80 hover:border-foreground/20"
            }`}
        >
            {/* Header: Star + Icon + Model ID + Actions */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => toggleFavorite(model.id)}
                        className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                            isFav
                                ? "text-amber-500 hover:text-amber-400 bg-amber-500/10"
                                : "text-muted-foreground hover:text-amber-500 opacity-40 group-hover:opacity-100 hover:bg-secondary"
                        }`}
                        title={
                            isFav
                                ? "Favorited (Pinned) - Click to unpin"
                                : "Star model (Pin to top)"
                        }
                        aria-label={isFav ? "Unstar model" : "Star model"}
                    >
                        <Star
                            className={`size-3.5 transition-transform ${
                                isFav ? "fill-amber-500 text-amber-500 scale-110" : ""
                            }`}
                        />
                    </button>

                    <div className="flex size-6 shrink-0 items-center justify-center rounded bg-secondary text-muted-foreground">
                        <Bot className="size-3.5" />
                    </div>

                    <span
                        className={`text-xs font-semibold truncate block flex-1 ${
                            isFav ? "text-foreground font-bold" : "text-foreground"
                        }`}
                        title={model.id}
                    >
                        {model.id}
                    </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={() => onCopy(model.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary transition-colors cursor-pointer"
                        title="Copy Model ID"
                    >
                        {copied ? (
                            <Check className="size-3 text-emerald-500" />
                        ) : (
                            <Copy className="size-3" />
                        )}
                    </button>
                    {onDelete && (
                        <button
                            type="button"
                            onClick={() => onDelete(model.id)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded transition-colors cursor-pointer"
                            title="Hide model"
                        >
                            <Trash2 className="size-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="pt-2.5 border-t border-border/60 flex items-center justify-between text-[10.5px]">
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span>Active</span>
                    </span>
                    {isFav && (
                        <span className="inline-flex items-center gap-0.5 rounded border border-border/80 bg-secondary/60 px-1.5 py-0.2 text-[9.5px] font-semibold text-foreground">
                            ★ Pinned
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
