import type { PlaygroundModel } from "./types";

interface RequestSummaryProps {
    selectedModel?: PlaygroundModel;
    temperature: number;
    topP: number;
    maxTokens?: number;
    systemPrompt: string;
    onEditParams: () => void;
}

export function RequestSummary({
    selectedModel,
    temperature,
    topP,
    maxTokens,
    systemPrompt,
    onEditParams,
}: RequestSummaryProps) {
    return (
        <aside
            className="hidden min-h-0 border border-border bg-muted/10 xl:block"
            aria-label="Request summary"
        >
            <div className="border-b border-border/70 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Request summary
            </div>
            <div className="divide-y divide-border/60 text-xs">
                <div className="space-y-1 px-4 py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Model
                    </p>
                    <p className="break-words font-mono text-[11px] leading-relaxed text-foreground">
                        {selectedModel?.id ?? "Not selected"}
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-3 px-4 py-4">
                    <div className="space-y-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                            Temp
                        </p>
                        <p className="font-mono text-[11px] text-foreground">
                            {temperature.toFixed(2)}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                            Top P
                        </p>
                        <p className="font-mono text-[11px] text-foreground">{topP.toFixed(2)}</p>
                    </div>
                </div>
                <div className="space-y-1 px-4 py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Max tokens
                    </p>
                    <p className="font-mono text-[11px] text-foreground">
                        {maxTokens ?? "Provider default"}
                    </p>
                </div>
                <div className="space-y-1 px-4 py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        System prompt
                    </p>
                    <p className="line-clamp-5 text-[11px] leading-relaxed text-muted-foreground">
                        {systemPrompt || "No system prompt"}
                    </p>
                    <button
                        type="button"
                        onClick={onEditParams}
                        className="pt-2 text-[11px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground"
                    >
                        Edit parameters
                    </button>
                </div>
            </div>
        </aside>
    );
}
