import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlaygroundModel } from "./types";

interface MessageComposerProps {
    input: string;
    selectedModel?: PlaygroundModel;
    streaming: boolean;
    onInputChange: (value: string) => void;
    onSend: () => void;
    onCancel: () => void;
}

export function MessageComposer({
    input,
    selectedModel,
    streaming,
    onInputChange,
    onSend,
    onCancel,
}: MessageComposerProps) {
    return (
        <div className="border-t border-border bg-muted/20 p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <label htmlFor="playground-message">Prompt</label>
                <span className="normal-case tracking-normal">
                    Enter to send · Shift + Enter for newline
                </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <textarea
                    id="playground-message"
                    value={input}
                    onChange={(event) => onInputChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            onSend();
                        }
                    }}
                    placeholder={
                        selectedModel ? `Message ${selectedModel.id}...` : "Select a model first..."
                    }
                    aria-describedby="playground-message-hint"
                    rows={3}
                    className="min-h-20 flex-1 resize-none rounded-none border border-border bg-background px-3 py-2.5 text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/40 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    disabled={streaming || !selectedModel}
                />
                <p id="playground-message-hint" className="sr-only">
                    Press Enter to send. Press Shift and Enter to add a new line.
                </p>
                {streaming ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={onCancel}
                        className="sm:min-w-24"
                    >
                        <Square />
                        Cancel
                    </Button>
                ) : (
                    <Button
                        type="button"
                        size="lg"
                        onClick={onSend}
                        disabled={!selectedModel || !input.trim()}
                        className="sm:min-w-24"
                    >
                        <Send />
                        Send
                    </Button>
                )}
            </div>
        </div>
    );
}
