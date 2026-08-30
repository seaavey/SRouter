import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Search, X } from "lucide-react";
import { toast } from "sonner";
import type { DBAPIKey, ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
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

type EditKeyDialogProps = {
    apiKey: DBAPIKey | null;
    open: boolean;
    updating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (
        id: string,
        data: {
            name: string;
            enabled: boolean;
            rateLimit?: number;
            quotaLimit?: number;
            creditLimit?: number;
            allowed_models?: string[] | null;
        }
    ) => Promise<unknown>;
};

type ModelScope = "all" | "restricted";

export function EditKeyDialog({
    apiKey,
    open,
    updating,
    onOpenChange,
    onSubmit
}: EditKeyDialogProps) {
    const [name, setName] = useState("");
    const [enabled, setEnabled] = useState(true);
    const [rateLimit, setRateLimit] = useState("");
    const [quotaLimit, setQuotaLimit] = useState("");
    const [creditLimit, setCreditLimit] = useState("");
    const [modelScope, setModelScope] = useState<ModelScope>("all");
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [modelSearch, setModelSearch] = useState("");
    const [copiedToken, setCopiedToken] = useState(false);

    useEffect(() => {
        if (apiKey) {
            setName(apiKey.name || "");
            setEnabled(Boolean(apiKey.enabled));
            setRateLimit(apiKey.rateLimit ? String(apiKey.rateLimit) : "");
            setQuotaLimit(apiKey.quotaLimit ? String(apiKey.quotaLimit) : "");
            setCreditLimit(apiKey.creditLimit ? String(apiKey.creditLimit) : "");
            if (apiKey.allowed_models && apiKey.allowed_models.length > 0) {
                setModelScope("restricted");
                setSelectedModels(apiKey.allowed_models);
            } else {
                setModelScope("all");
                setSelectedModels([]);
            }
            setModelSearch("");
        }
    }, [apiKey, open]);

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

    const toggleModel = (modelId: string) => {
        setSelectedModels((prev) =>
            prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
        );
    };

    const handleCopyToken = async () => {
        if (!apiKey) return;
        try {
            await navigator.clipboard.writeText(apiKey.key);
            setCopiedToken(true);
            toast.success("API key copied to clipboard");
            setTimeout(() => setCopiedToken(false), 1600);
        } catch {
            toast.error("Could not copy key");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) return;
        const trimmedName = name.trim();
        if (!trimmedName) return;

        const rateNum = rateLimit.trim() ? parseInt(rateLimit, 10) : undefined;
        const quotaNum = quotaLimit.trim() ? parseInt(quotaLimit, 10) : undefined;
        const creditNum = creditLimit.trim() ? parseFloat(creditLimit) : undefined;
        const allowedModels =
            modelScope === "restricted" && selectedModels.length > 0 ? selectedModels : null;

        await onSubmit(apiKey.id, {
            name: trimmedName,
            enabled,
            rateLimit: Number.isFinite(rateNum) && (rateNum ?? 0) >= 0 ? rateNum : 0,
            quotaLimit: Number.isFinite(quotaNum) && (quotaNum ?? 0) >= 0 ? quotaNum : 0,
            creditLimit: Number.isFinite(creditNum) && (creditNum ?? 0) >= 0 ? creditNum : 0,
            allowed_models: allowedModels
        });

        onOpenChange(false);
    };

    if (!apiKey) return null;

    const remainingCredit =
        (apiKey.creditLimit ?? 0) > 0
            ? Math.max(0, (apiKey.creditLimit ?? 0) - (apiKey.usageCost ?? 0))
            : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-md bg-secondary text-foreground">
                            <KeyRound className="size-3.5" />
                        </div>
                        <DialogTitle className="text-base font-semibold text-foreground">
                            API Key Details & Settings
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        View telemetry and configure rate limits, quotas, and model scopes.
                    </DialogDescription>
                </DialogHeader>

                {/* Key Telemetry Summary Card */}
                <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">Bearer Token</span>
                        <code
                            onClick={() => void handleCopyToken()}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-secondary hover:border-border cursor-pointer transition-colors"
                            title="Click to copy full key"
                        >
                            {apiKey.key}
                            {copiedToken ? (
                                <Check className="size-3 text-emerald-500" />
                            ) : (
                                <Copy className="size-3 opacity-60" />
                            )}
                        </code>
                    </div>

                    <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 bg-background/60 py-2 px-1 text-center font-mono">
                        <div className="px-2">
                            <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                                Usage
                            </span>
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                                {formatCompactNumber(apiKey.usageTokens ?? 0)}{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">tok</span>
                            </span>
                        </div>
                        <div className="px-2">
                            <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                                Spent
                            </span>
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                                ${(apiKey.usageCost ?? 0).toFixed(2)}
                            </span>
                        </div>
                        <div className="px-2">
                            <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                                Balance
                            </span>
                            <span className="text-xs font-semibold text-emerald-500 tabular-nums">
                                {remainingCredit !== null ? `$${remainingCredit.toFixed(2)}` : "Unlimited"}
                            </span>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    {/* Name & Active Status */}
                    <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-1.5">
                            <label
                                htmlFor="edit-key-name"
                                className="block text-xs font-medium text-foreground"
                            >
                                Key Name <span className="text-destructive">*</span>
                            </label>
                            <Input
                                id="edit-key-name"
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. production-backend"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-foreground">Status</label>
                            <button
                                type="button"
                                onClick={() => setEnabled(!enabled)}
                                className={`h-9 px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    enabled
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        : "border-border bg-secondary/40 text-muted-foreground"
                                }`}
                            >
                                <span
                                    className={`size-1.5 rounded-full ${
                                        enabled ? "bg-emerald-500" : "bg-muted-foreground/60"
                                    }`}
                                />
                                {enabled ? "Active" : "Disabled"}
                            </button>
                        </div>
                    </div>

                    {/* Limits Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* Rate Limit */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="edit-rate-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Rate limit{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    (req/m)
                                </span>
                            </label>
                            <Input
                                id="edit-rate-limit"
                                type="number"
                                min="0"
                                value={rateLimit}
                                onChange={(e) => setRateLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>

                        {/* Token Quota */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="edit-quota-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Token quota{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    (tokens)
                                </span>
                            </label>
                            <Input
                                id="edit-quota-limit"
                                type="number"
                                min="0"
                                value={quotaLimit}
                                onChange={(e) => setQuotaLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>

                        {/* Credit Limit */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="edit-credit-limit"
                                className="block text-xs font-medium text-foreground"
                            >
                                Credit limit{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    ($ USD)
                                </span>
                            </label>
                            <Input
                                id="edit-credit-limit"
                                type="number"
                                min="0"
                                step="0.01"
                                value={creditLimit}
                                onChange={(e) => setCreditLimit(e.target.value)}
                                placeholder="Unlimited"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>
                    </div>

                    {/* Allowed Models Scope */}
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-foreground">
                            Allowed Models
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

                                <div className="max-h-40 overflow-y-auto rounded-md">
                                    {modelsPending ? (
                                        <p className="py-3 text-center text-[11px] text-muted-foreground">
                                            Loading models…
                                        </p>
                                    ) : filteredModels.length === 0 ? (
                                        <p className="py-3 text-center text-[11px] text-muted-foreground">
                                            No models match your search.
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {filteredModels.map((model) => {
                                                const isSelected = selectedModels.includes(model.id);
                                                return (
                                                    <li key={model.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleModel(model.id)}
                                                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors cursor-pointer ${
                                                                isSelected
                                                                    ? "bg-primary/10 text-foreground font-medium"
                                                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                                            }`}
                                                        >
                                                            <span className="truncate">{model.id}</span>
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

                                <p className="text-[11px] text-muted-foreground font-sans">
                                    {selectedModels.length > 0
                                        ? `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"} selected`
                                        : "Select at least one model, or the key stays unrestricted."}
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="pt-2 gap-2">
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
                            disabled={updating || !name.trim()}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {updating ? "Saving…" : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
