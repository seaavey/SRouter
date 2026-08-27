import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
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
            <DialogContent className="sm:max-w-md font-mono">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-sm">
                        <Bot className="size-4 text-amber-500" />
                        Add Custom Model
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Manually register a model under <b>{providerName}</b>. Requests to{" "}
                        <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">
                            &lt;alias&gt;/&lt;model-id&gt;
                        </code>{" "}
                        will route through this provider's active connections.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-2">
                    <Input
                        autoFocus
                        placeholder="e.g. gemini-3.0-ultra-preview"
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSubmit();
                        }}
                        className="h-9 font-mono text-xs"
                    />
                    {error && <p className="text-[11px] text-destructive">{error}</p>}
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs cursor-pointer"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs cursor-pointer gap-1.5"
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
