import React, { useState } from "react";
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
import { Input } from "@/components/ui/input";

type AddCreditDialogProps = {
    apiKey: DBAPIKey | null;
    open: boolean;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (keyId: string, amount: number) => Promise<void>;
};

const QUICK_AMOUNTS = [5, 10, 25, 50];

export function AddCreditDialog({
    apiKey,
    open,
    loading,
    onOpenChange,
    onSubmit
}: AddCreditDialogProps) {
    const [amount, setAmount] = useState("");

    if (!apiKey) return null;

    const currentLimit = apiKey.creditLimit ?? 0;
    const currentCost = apiKey.usageCost ?? 0;
    const remainingBalance = currentLimit > 0 ? Math.max(0, currentLimit - currentCost) : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const num = parseFloat(amount);
        if (!Number.isFinite(num) || num <= 0) return;

        await onSubmit(apiKey.id, num);
        setAmount("");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Add Credit
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Add prepaid dollar balance to{" "}
                        <span className="font-semibold text-foreground font-mono">{apiKey.name}</span>.
                    </DialogDescription>
                </DialogHeader>

                {/* Current Balance Summary */}
                <div className="rounded-lg border border-border/70 bg-secondary/30 p-3 my-2 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Current Balance:</span>
                        <span className="font-mono font-semibold text-foreground">
                            {remainingBalance !== null
                                ? `$${remainingBalance.toFixed(2)} USD`
                                : "Unlimited"}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                        <span>Lifetime Spent:</span>
                        <span className="font-mono">${currentCost.toFixed(3)} USD</span>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    <div className="space-y-2">
                        <label
                            htmlFor="add-amount"
                            className="block text-xs font-medium text-foreground"
                        >
                            Amount to add ($ USD) <span className="text-destructive">*</span>
                        </label>
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
                            className="h-9 font-mono text-xs rounded-md bg-background border-input"
                        />

                        {/* Quick Chip Shortcuts */}
                        <div className="flex items-center gap-1.5 pt-1">
                            {QUICK_AMOUNTS.map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setAmount(String(val))}
                                    className="rounded-md border border-border/70 bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                                >
                                    +${val}
                                </button>
                            ))}
                        </div>
                    </div>

                    <DialogFooter className="pt-3 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-8.5 text-xs font-medium cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading || !amount || parseFloat(amount) <= 0}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {loading ? "Adding…" : "Add Credit"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
