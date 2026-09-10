import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComboHeaderProps {
    isAdding: boolean;
    onToggleAdd: () => void;
}

export function ComboHeader({ isAdding, onToggleAdd }: ComboHeaderProps) {
    return (
        <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end font-sans">
            <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                    <span className="size-2 shrink-0 rounded-full bg-ink" />
                    <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                        Resilience & Failover
                    </p>
                </div>
                <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                    Fallback Pipelines.
                </h1>
                <p className="mt-1 text-base font-light text-text-muted font-sans max-w-3xl">
                    Configure multi-model fallback cascades. When a primary model encounters rate
                    limits (429), quota exhaustion (403), or provider errors (5xx), SRouter cascades
                    down your priority sequence seamlessly.
                </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                {!isAdding && (
                    <Button
                        type="button"
                        onClick={onToggleAdd}
                        className="h-10 shrink-0 gap-2 rounded-full px-5 text-sm font-semibold cursor-pointer shadow-none"
                    >
                        <Plus className="size-4" />
                        <span>Create Combo</span>
                    </Button>
                )}
            </div>
        </header>
    );
}
