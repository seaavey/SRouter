import { useEffect, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import type { APIKeyZod } from "@srouter/types";
import { useCopy } from "@/hooks/useCopy";
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

export type KeySecretModalProps = {
    new_key: APIKeyZod | null;
    onClose: () => void;
};

export function KeySecretModal({ new_key, onClose }: KeySecretModalProps) {
    const { copied, copy } = useCopy();
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(new_key);

    useEffect(() => {
        if (new_key) {
            setCachedKey(new_key);
        }
    }, [new_key]);

    const active_key = new_key ?? cachedKey;

    return (
        <Dialog open={Boolean(new_key)} onOpenChange={(open) => !open && onClose()}>
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

                {active_key ? (
                    <div className="space-y-3.5 py-2">
                        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 flex items-start gap-2.5">
                            <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                                Store this key securely in your environment variables. If you lose
                                it, you will need to generate a new key.
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-medium text-foreground">
                                <span>{active_key.name}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                    {active_key.id}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="text"
                                    readOnly
                                    value={active_key.key}
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground select-all focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <Button
                                    type="button"
                                    onClick={() =>
                                        void copy(active_key.key, "API key copied to clipboard")
                                    }
                                    className="h-9 px-3.5 text-xs font-semibold shrink-0 cursor-pointer shadow-xs gap-1.5"
                                >
                                    {copied === active_key.key ? (
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

                        {(active_key.credit_limit > 0 ||
                            active_key.quota_limit > 0 ||
                            active_key.rate_limit > 0) && (
                            <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground pt-1">
                                {active_key.credit_limit > 0 && (
                                    <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                        Credit: ${active_key.credit_limit.toFixed(2)} USD
                                    </span>
                                )}
                                {active_key.quota_limit > 0 && (
                                    <span className="rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5">
                                        Quota: {active_key.quota_limit.toLocaleString()} tokens
                                    </span>
                                )}
                                {active_key.rate_limit > 0 && (
                                    <span className="rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5">
                                        Rate: {active_key.rate_limit.toLocaleString()} req/m
                                    </span>
                                )}
                            </div>
                        )}

                        {active_key.allowed_models && active_key.allowed_models.length > 0 ? (
                            <div className="space-y-1.5">
                                <span className="block text-xs font-medium text-foreground">
                                    Allowed models
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {active_key.allowed_models.map((model) => (
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
                ) : null}

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
