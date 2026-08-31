import { GitFork, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComboHeaderProps {
    isAdding: boolean;
    onToggleAdd: () => void;
}

export function ComboHeader({ isAdding, onToggleAdd }: ComboHeaderProps) {
    return (
        <header className="rounded-xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Left Header Info */}
                <div className="space-y-1 text-left min-w-0">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-lg border border-border/80 bg-secondary/80 text-foreground shadow-2xs">
                            <GitFork className="size-3.5" />
                        </div>
                        <h1 className="text-base font-bold tracking-tight text-foreground">
                            Model Combos &amp; Fallbacks
                        </h1>
                    </div>

                    <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                        Configure multi-model fallback cascades. When a primary model encounters
                        rate limits (429), quota exhaustion (403), or errors (5xx), SRouter cascades
                        down your priority list seamlessly.
                    </p>
                </div>

                {/* Right Action */}
                <div className="flex items-center gap-2 shrink-0">
                    {!isAdding && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onToggleAdd}
                            className="h-9 px-4 text-xs font-semibold gap-1.5 cursor-pointer shadow-xs bg-foreground text-background hover:bg-foreground/90"
                        >
                            <Plus className="size-3.5" />
                            <span>Create Combo</span>
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
}
