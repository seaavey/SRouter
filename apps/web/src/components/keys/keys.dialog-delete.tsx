import { useEffect, useState } from "react";
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
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-destructive">
                        Revoke API Key
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Are you sure you want to revoke{" "}
                        <span className="font-semibold text-foreground">{active_key?.name}</span>?
                        Any downstream requests using this token will immediately fail with HTTP 401
                        Unauthorized.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs font-mono space-y-1 my-1">
                    <div className="text-muted-foreground text-[11px]">Token identifier</div>
                    <code className="text-foreground text-xs">
                        {active_key ? maskKey(active_key.key) : ""}
                    </code>
                </div>

                <DialogFooter className="pt-2 gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        className="h-8.5 text-xs font-medium cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || !active_key}
                        onClick={() => active_key && void onConfirm(active_key.id)}
                        className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        {deleting ? "Revoking…" : "Revoke Key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
