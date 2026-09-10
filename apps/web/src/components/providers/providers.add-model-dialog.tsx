import { useState } from "react";
import { Bot, Loader2, X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddModelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    providerName: string;
    isPending: boolean;
    onSubmit: (modelId: string) => void;
}

export function AddModelDialog({
    open,
    onOpenChange,
    providerName,
    isPending,
    onSubmit
}: AddModelDialogProps) {
    const [modelId, setModelId] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = () => {
        const trimmed = modelId.trim();
        if (!trimmed) {
            setError("Model ID is required");
            return;
        }
        setError("");
        onSubmit(trimmed);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setModelId("");
                    setError("");
                }
                onOpenChange(next);
            }}
        >
            <DialogContent className="sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-6 md:p-8 space-y-5 shadow-none font-sans">
                <DialogHeader className="space-y-1 pb-2 border-b border-hairline-soft">
                    <DialogTitle className="flex items-center gap-2 text-base font-bold text-ink">
                        <Bot className="size-4 text-accent" />
                        <span>Add Custom Model.</span>
                    </DialogTitle>
                    <DialogDescription className="text-xs text-text-muted">
                        Manually register a model under <b className="text-ink">{providerName}</b>.
                        Requests to{" "}
                        <code className="rounded-full bg-field px-2 py-0.5 text-[10px] font-mono text-ink">
                            &lt;alias&gt;/&lt;model-id&gt;
                        </code>{" "}
                        will route through this provider's active connections.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-1">
                    <Input
                        placeholder="e.g. gemini-3.0-ultra-preview"
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSubmit();
                        }}
                        className="h-10 font-mono text-xs rounded-2xl bg-field border-0 text-ink placeholder:text-text-faint px-4 focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
                    />
                    {error && <p className="text-xs text-destructive font-mono">{error}</p>}
                </div>

                <DialogFooter className="gap-2 pt-2 border-t border-hairline-soft">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full px-4 h-9 text-xs font-semibold cursor-pointer border-hairline bg-canvas hover:bg-canvas-soft text-ink shadow-none"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none"
                        disabled={isPending}
                        onClick={handleSubmit}
                    >
                        {isPending && <Loader2 className="size-3.5 animate-spin" />}
                        Add Model
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
