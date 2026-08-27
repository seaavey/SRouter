import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import type { ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
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

type CreateKeyDialogProps = {
    open: boolean;
    creating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: {
        name: string;
        rateLimit?: number;
        quotaLimit?: number;
        creditLimit?: number;
        allowed_models?: string[] | null;
    }) => Promise<void>;
};

type ModelScope = "all" | "restricted";

export function CreateKeyDialog({ open, creating, onOpenChange, onSubmit }: CreateKeyDialogProps) {
    const [name, setName] = useState("");
    const [rateLimit, setRateLimit] = useState("");
    const [quotaLimit, setQuotaLimit] = useState("");
    const [creditLimit, setCreditLimit] = useState("");
    const [modelScope, setModelScope] = useState<ModelScope>("all");
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [modelSearch, setModelSearch] = useState("");

    const { data: modelsData, isPending: modelsPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: open && modelScope === "restricted"
    });

    const models = useMemo(() => modelsData?.data ?? [], [modelsData]);

    const filteredModels = useMemo(() => {
        const query = modelSearch.trim().toLowerCase();
        if (!query) return models;
        return models.filter((m) => m.id.toLowerCase().includes(query));
    }, [models, modelSearch]);

    const resetForm = () => {
        setName("");
        setRateLimit("");
        setQuotaLimit("");
        setCreditLimit("");
        setModelScope("all");
        setSelectedModels([]);
        setModelSearch("");
    };

    const toggleModel = (modelId: string) => {
        setSelectedModels((prev) =>
            prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return;

        const rateNum = rateLimit.trim() ? parseInt(rateLimit, 10) : undefined;
        const quotaNum = quotaLimit.trim() ? parseInt(quotaLimit, 10) : undefined;
        const creditNum = creditLimit.trim() ? parseFloat(creditLimit) : undefined;
        const allowedModels =
            modelScope === "restricted" && selectedModels.length > 0 ? selectedModels : null;

        await onSubmit({
            name: trimmedName,
            rateLimit: Number.isFinite(rateNum) && (rateNum ?? 0) > 0 ? rateNum : undefined,
            quotaLimit: Number.isFinite(quotaNum) && (quotaNum ?? 0) > 0 ? quotaNum : undefined,
            creditLimit: Number.isFinite(creditNum) && (creditNum ?? 0) > 0 ? creditNum : undefined,
            allowed_models: allowedModels
        });

        resetForm();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Create API Key
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Generate a bearer token for SDKs, clients, and automated workloads.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    {/* Key Name / Label */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="key-name"
                            className="block text-xs font-medium text-foreground"
                        >
                            Name <span className="text-destructive">*</span>
                        </label>
                        <Input
                            id="key-name"
                            type="text"
                            required
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. production-backend, cursor-agent"
                            className="h-9 font-mono text-xs rounded-md bg-background border-input"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            A descriptive identifier to track where this key is used.
                        </p>
                    </div>

                    {/* Limits Section */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                        {/* Rate Limit */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="rate-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Rate limit{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    (req/m)
                                </span>
                            </label>
                            <Input
                                id="rate-limit"
                                type="number"
                                min="0"
                                value={rateLimit}
                                onChange={(e) => setRateLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Max req/min
                            </p>
                        </div>

                        {/* Token Quota */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="quota-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Token quota{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    (tokens)
                                </span>
                            </label>
                            <Input
                                id="quota-limit"
                                type="number"
                                min="0"
                                value={quotaLimit}
                                onChange={(e) => setQuotaLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Max tokens
                            </p>
                        </div>

                        {/* Credit Limit */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="credit-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Credit limit{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    ($ USD)
                                </span>
                            </label>
                            <Input
                                id="credit-limit"
                                type="number"
                                min="0"
                                step="0.01"
                                value={creditLimit}
                                onChange={(e) => setCreditLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Prepaid budget
                            </p>
                        </div>
                    </div>

                    {/* Allowed Models Scope */}
                    <div className="space-y-2 pt-1">
                        <label className="block text-xs font-medium text-foreground">
                            Allowed models
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setModelScope("all")}
                                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                    modelScope === "all"
                                        ? "border-primary bg-primary/10 text-foreground font-semibold"
                                        : "border-input bg-background text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                All models
                                <span className="block text-[10px] font-normal opacity-70">
                                    Unrestricted access
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setModelScope("restricted")}
                                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                    modelScope === "restricted"
                                        ? "border-primary bg-primary/10 text-foreground font-semibold"
                                        : "border-input bg-background text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Specific models
                                <span className="block text-[10px] font-normal opacity-70">
                                    Restrict to a subset
                                </span>
                            </button>
                        </div>

                        {modelScope === "restricted" && (
                            <div className="space-y-2 rounded-md border border-border/70 bg-background/50 p-2.5">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                                    <Input
                                        type="text"
                                        value={modelSearch}
                                        onChange={(e) => setModelSearch(e.target.value)}
                                        placeholder="Search models…"
                                        className="h-8 pl-8 pr-7 font-mono text-xs rounded-md bg-background"
                                    />
                                    {modelSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setModelSearch("")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                            aria-label="Clear search"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    )}
                                </div>

                                <div className="max-h-44 overflow-y-auto rounded-md">
                                    {modelsPending ? (
                                        <p className="py-4 text-center text-[11px] text-muted-foreground">
                                            Loading models…
                                        </p>
                                    ) : filteredModels.length === 0 ? (
                                        <p className="py-4 text-center text-[11px] text-muted-foreground">
                                            No models matched your search.
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {filteredModels.map((model) => {
                                                const isSelected = selectedModels.includes(
                                                    model.id
                                                );
                                                return (
                                                    <li key={model.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleModel(model.id)}
                                                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors cursor-pointer ${
                                                                isSelected
                                                                    ? "bg-primary/10 text-foreground"
                                                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                                            }`}
                                                        >
                                                            <span className="truncate">
                                                                {model.id}
                                                            </span>
                                                            {isSelected && (
                                                                <Check className="size-3.5 shrink-0 text-primary" />
                                                            )}
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>

                                <p className="text-[11px] text-muted-foreground">
                                    {selectedModels.length > 0
                                        ? `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"} selected`
                                        : "Select at least one model, or the key stays unrestricted."}
                                </p>
                            </div>
                        )}
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
                            disabled={creating || !name.trim()}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {creating ? "Creating…" : "Create API Key"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
