import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { APIKeyZod } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { maskKey } from "./keys.form-types";

export type KeyDeleteDialogProps = {
    IDKey: APIKeyZod | null;
    deleting: boolean;
    onClose: () => void;
    onConfirm: (keyId: string) => Promise<void>;
};

export function KeyDeleteDialog({ IDKey, deleting, onClose, onConfirm }: KeyDeleteDialogProps) {
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(IDKey);

    useEffect(() => {
        if (IDKey) {
            setCachedKey(IDKey);
        }
    }, [IDKey]);

    const active_key = IDKey ?? cachedKey;

    return (
        <Dialog open={Boolean(IDKey)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-0 overflow-hidden flex flex-col shadow-none font-sans">
                <DialogHeader className="px-6 py-5 border-b border-red-500/20 bg-red-500/5 shrink-0 text-left">
                    <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                            <AlertTriangle className="size-4" />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-[650] tracking-tight text-red-600 dark:text-red-400 font-sans">
                                Revoke API Key.
                            </DialogTitle>
                            <DialogDescription className="text-xs text-text-muted leading-tight font-sans mt-0.5">
                                This action is permanent and immediate.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="p-6 space-y-4">
                    <p className="text-xs text-text-muted leading-relaxed font-sans">
                        Are you sure you want to revoke{" "}
                        <span className="font-semibold font-sans text-ink">{active_key?.name}</span>
                        ? Any downstream requests using this token will immediately fail with HTTP
                        401 Unauthorized.
                    </p>

                    <div className="rounded-2xl border border-hairline-soft bg-canvas-soft p-3.5 text-xs font-mono space-y-1">
                        <div className="text-text-muted text-[10px] uppercase font-mono tracking-wider">
                            Token identifier
                        </div>
                        <code className="text-ink text-xs block truncate font-mono">
                            {active_key ? maskKey(active_key.key) : ""}
                        </code>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-hairline-soft bg-canvas shrink-0 flex items-center justify-end gap-2 mt-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        className="h-9 rounded-full px-5 text-xs font-medium cursor-pointer shadow-none"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || !active_key}
                        onClick={() => active_key && void onConfirm(active_key.id)}
                        className="h-9 rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none bg-red-600 text-white hover:bg-red-700"
                    >
                        {deleting ? "Revoking…" : "Revoke Key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
