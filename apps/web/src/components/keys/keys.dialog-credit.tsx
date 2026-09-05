import React, { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { quick_amounts } from "./keys.form-types";

export type AddCreditDialogProps = {
    api_key: APIKeyZod | null;
    open: boolean;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (keyId: string, amount: number) => Promise<void>;
};

export function AddCreditDialog({
    api_key,
    open,
    loading,
    onOpenChange,
    onSubmit
}: AddCreditDialogProps) {
    const [amount, setAmount] = useState("");
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(api_key);

    useEffect(() => {
        if (api_key) {
            setCachedKey(api_key);
        }
    }, [api_key]);

    const active_key = api_key ?? cachedKey;

    const current_limit = active_key?.credit_limit ?? 0;
    const current_cost = active_key?.usage_cost ?? 0;
    const remaining_balance = current_limit > 0 ? Math.max(0, current_limit - current_cost) : null;

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const num = parseFloat(amount);
        if (!Number.isFinite(num) || num <= 0 || !active_key) return;

        await onSubmit(active_key.id, num);
        setAmount("");
        onOpenChange(false);
    };

    return (
        <Dialog open={open && Boolean(active_key)} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-card border-border/80 p-0 overflow-hidden flex flex-col shadow-2xl">
                <DialogHeader className="px-5 py-4 border-b border-border/60 bg-secondary/10 shrink-0 text-left">
                    <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
                        Add Credit
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Add prepaid dollar balance to{" "}
                        <span className="font-semibold text-foreground font-mono">
                            {active_key?.name}
                        </span>
                        .
                    </DialogDescription>
                </DialogHeader>

                <div className="p-5 space-y-4">
                    <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 text-xs space-y-1.5 font-mono">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground font-sans">Current Balance:</span>
                            <span className="font-semibold text-foreground">
                                {remaining_balance !== null
                                    ? `$${remaining_balance.toFixed(2)} USD`
                                    : "Unlimited"}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-muted-foreground font-mono">
                            <span className="font-sans">Lifetime Spent:</span>
                            <span>${current_cost.toFixed(3)} USD</span>
                        </div>
                    </div>

                    <form id="add-credit-form" onSubmit={handleSubmit} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="add-amount"
                                className="block text-xs font-medium text-foreground"
                            >
                                Amount to add ($ USD) <span className="text-destructive font-mono">*</span>
                            </Label>
                            <Input
                                id="add-amount"
                                type="number"
                                min="0.01"
                                step="0.01"
                                required
                                autoFocus
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="e.g. 10.00"
                                className="h-8.5 font-mono text-xs rounded-md bg-background border-input"
                            />

                            <div className="flex items-center gap-1.5 pt-1">
                                {quick_amounts.map((val) => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setAmount(String(val))}
                                        className="rounded border border-border/70 bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                                    >
                                        +${val}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </form>
                </div>

                <DialogFooter className="px-5 py-3 border-t border-border/60 bg-secondary/15 shrink-0 flex items-center justify-end gap-2 mt-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="h-8 text-xs font-medium cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="add-credit-form"
                        disabled={loading || !amount || parseFloat(amount) <= 0}
                        className="h-8 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        {loading ? "Adding…" : "Add Credit"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
