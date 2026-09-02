import React from "react";
import { CornerDownLeft, Sparkles } from "lucide-react";

interface ResponseFollowUpsProps {
    onSelectFollowUp: (prompt: string) => void;
    lastPrompt?: string;
}

const DEFAULT_FOLLOW_UPS = [
    "Can you provide unit tests for this implementation?",
    "Explain the performance trade-offs and complexity.",
    "Refactor this into a more modular structure.",
    "How would you handle edge cases and error recovery?"
];

export function ResponseFollowUps({ onSelectFollowUp }: ResponseFollowUpsProps) {
    return (
        <div className="mt-3.5 border-t border-border/40 pt-3">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-2.5 text-foreground" />
                <span>Suggested Follow-ups</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {DEFAULT_FOLLOW_UPS.map((followUp, index) => (
                    <button
                        key={index}
                        type="button"
                        onClick={() => onSelectFollowUp(followUp)}
                        className="group flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1 text-left font-mono text-[11px] text-muted-foreground transition-all hover:border-foreground/40 hover:bg-secondary/70 hover:text-foreground"
                    >
                        <span>{followUp}</span>
                        <CornerDownLeft className="size-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                ))}
            </div>
        </div>
    );
}
