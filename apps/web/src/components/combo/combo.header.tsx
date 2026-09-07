import { GitFork, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComboHeaderProps {
    isAdding: boolean;
    onToggleAdd: () => void;
}

export function ComboHeader({ isAdding, onToggleAdd }: ComboHeaderProps) {
    return (
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5 font-mono">
            <div className="space-y-1 text-left min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                    High Availability & Failover
                </p>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Model Combos
                </h1>
                <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                    Configure multi-model fallback cascades. When a primary model encounters
                    rate limits (429), quota exhaustion (403), or provider errors (5xx), SRouter cascades
                    down your priority sequence seamlessly.
                </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {!isAdding && (
                    <Button
                        type="button"
                        size="sm"
                        onClick={onToggleAdd}
                        className="h-8 px-3.5 text-xs font-semibold gap-1.5 cursor-pointer shadow-2xs"
                    >
                        <Plus className="size-3.5" />
                        <span>Create Combo</span>
                    </Button>
                )}
            </div>
        </header>
    );
}
