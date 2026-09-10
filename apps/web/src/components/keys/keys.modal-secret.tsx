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
            <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-0 overflow-hidden flex flex-col shadow-none font-sans">
                <DialogHeader className="px-6 py-5 border-b border-hairline-soft bg-canvas shrink-0 text-left">
                    <DialogTitle className="text-base font-[650] tracking-tight text-ink font-sans">
                        Save Your API Key.
                    </DialogTitle>
                    <DialogDescription className="text-xs text-text-muted font-sans mt-0.5">
                        Copy this secret token now. For security reasons, it will not be shown
                        again.
                    </DialogDescription>
                </DialogHeader>

                {active_key ? (
                    <div className="p-6 space-y-4 max-h-[calc(100dvh-12rem)] overflow-y-auto">
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
                            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed font-sans">
                                Store this key securely in your environment variables. If you lose
                                it, you will need to generate a new key.
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-medium text-ink">
                                <span className="font-sans font-semibold">{active_key.name}</span>
                                <span className="font-mono text-[10px] text-text-muted">
                                    {active_key.id}
                                </span>
                            </div>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <Input
                                    type="text"
                                    readOnly
                                    value={active_key.key}
                                    className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 font-mono text-xs text-ink select-all focus:outline-none shadow-none"
                                />
                                <Button
                                    type="button"
                                    onClick={() =>
                                        void copy(active_key.key, "API key copied to clipboard")
                                    }
                                    className="h-9 rounded-full px-4 text-xs font-semibold shrink-0 cursor-pointer shadow-none gap-1.5 w-full sm:w-auto"
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
                            <div className="flex flex-wrap gap-2 text-xs font-mono text-text-muted pt-1">
                                {active_key.credit_limit > 0 && (
                                    <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1 text-ink font-semibold">
                                        Credit: ${active_key.credit_limit.toFixed(2)} USD
                                    </span>
                                )}
                                {active_key.quota_limit > 0 && (
                                    <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1">
                                        Quota: {active_key.quota_limit.toLocaleString()} tokens
                                    </span>
                                )}
                                {active_key.rate_limit > 0 && (
                                    <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1">
                                        Rate: {active_key.rate_limit.toLocaleString()} req/m
                                    </span>
                                )}
                            </div>
                        )}

                        {active_key.allowed_models && active_key.allowed_models.length > 0 ? (
                            <div className="space-y-2">
                                <span className="block text-xs font-medium text-ink font-sans">
                                    Allowed models
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {active_key.allowed_models.map((model) => (
                                        <span
                                            key={model}
                                            className="inline-flex items-center rounded-full border border-hairline-soft bg-canvas-soft px-2.5 py-0.5 font-mono text-xs text-ink"
                                        >
                                            {model}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-text-muted font-sans">
                                This key can access all models.
                            </p>
                        )}
                    </div>
                ) : null}

                <DialogFooter className="px-6 py-4 border-t border-hairline-soft bg-canvas shrink-0 flex items-center justify-end mt-0">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto h-9 rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none"
                    >
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
