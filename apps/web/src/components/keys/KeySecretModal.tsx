import { useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import type { DBAPIKey } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type KeySecretModalProps = {
    newKey: DBAPIKey | null;
    onClose: () => void;
};

export function KeySecretModal({ newKey, onClose }: KeySecretModalProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
        }
    };

    if (!newKey) return null;

    return (
        <Dialog open={Boolean(newKey)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Save Your API Key
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Copy this secret token now. For security reasons, it will not be shown
                        again.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3.5 py-2">
                    {/* Security Notice */}
                    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 flex items-start gap-2.5">
                        <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            Store this key securely in your environment variables. If you lose it,
                            you will need to generate a new key.
                        </div>
                    </div>

                    {/* Key Value & Copy Box */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-medium text-foreground">
                            <span>{newKey.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                                {newKey.id}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                readOnly
                                value={newKey.key}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground select-all focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <Button
                                type="button"
                                onClick={() => void handleCopy(newKey.key)}
                                className="h-9 px-3.5 text-xs font-semibold shrink-0 cursor-pointer shadow-xs gap-1.5"
                            >
                                {copied ? (
                                    <>
                                        <Check className="size-3.5 text-emerald-400" />
                                        <span>Copied</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="size-3.5" />
                                        <span>Copy</span>
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                    {newKey.allowed_models && newKey.allowed_models.length > 0 ? (
                        <div className="space-y-1.5">
                            <span className="block text-xs font-medium text-foreground">
                                Allowed models
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                                {newKey.allowed_models.map((model) => (
                                    <span
                                        key={model}
                                        className="inline-flex items-center rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-foreground"
                                    >
                                        {model}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground">
                            This key can access all models.
                        </p>
                    )}
                </div>

                <DialogFooter className="pt-2">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
