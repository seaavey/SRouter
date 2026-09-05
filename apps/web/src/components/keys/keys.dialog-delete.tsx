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
            <DialogContent className="sm:max-w-md bg-card border-border/80 p-0 overflow-hidden flex flex-col shadow-2xl">
                <DialogHeader className="px-5 py-4 border-b border-border/60 bg-destructive/10 shrink-0 text-left">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-7.5 shrink-0 items-center justify-center rounded-md border border-destructive/30 bg-destructive/15 text-destructive">
                            <AlertTriangle className="size-4" />
                        </div>
                        <div>
                            <DialogTitle className="text-sm font-semibold tracking-tight text-destructive">
                                Revoke API Key
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground leading-tight mt-0.5">
                                This action is permanent and immediate.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="p-5 space-y-3.5">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Are you sure you want to revoke{" "}
                        <span className="font-semibold font-mono text-foreground">{active_key?.name}</span>?
                        Any downstream requests using this token will immediately fail with HTTP 401
                        Unauthorized.
                    </p>

                    <div className="rounded-md border border-border/80 bg-background/60 p-3 text-xs font-mono space-y-1">
                        <div className="text-muted-foreground text-[10px] uppercase">Token identifier</div>
                        <code className="text-foreground text-xs block truncate">
                            {active_key ? maskKey(active_key.key) : ""}
                        </code>
                    </div>
                </div>

                <DialogFooter className="px-5 py-3 border-t border-border/60 bg-secondary/15 shrink-0 flex items-center justify-end gap-2 mt-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        className="h-8 text-xs font-medium cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || !active_key}
                        onClick={() => active_key && void onConfirm(active_key.id)}
                        className="h-8 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        {deleting ? "Revoking…" : "Revoke Key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
