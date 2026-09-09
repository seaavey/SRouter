import { useState, useMemo } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, Trash2, Search, X } from "lucide-react";
import { toast } from "sonner";
import type { APIKeyZod } from "@srouter/types";
import { formatCompactNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";

export type KeyTableProps = {
    keys: APIKeyZod[];
    deletingId: string | null;
    onCreateClick: () => void;
    onEditClick: (key: APIKeyZod) => void;
    onDeleteClick: (key: APIKeyZod) => void;
};

function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export function KeyTable({
    keys,
    deletingId,
    onCreateClick,
    onEditClick,
    onDeleteClick
}: KeyTableProps) {
    const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedSearch = useDebounce(searchQuery, 150);

    const filteredKeys = useMemo(() => {
        const query = debouncedSearch.trim().toLowerCase();
        if (!query) return keys;
        return keys.filter(
            (k) =>
                k.name.toLowerCase().includes(query) ||
                k.key.toLowerCase().includes(query) ||
                (k.allowed_models && k.allowed_models.some((m) => m.toLowerCase().includes(query)))
        );
    }, [keys, debouncedSearch]);

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedKeyId(id);
            toast.success("API key copied to clipboard");
            setTimeout(() => setCopiedKeyId(null), 1600);
        } catch {
            toast.error("Could not copy API key");
        }
    };

    // ── Pure, Minimal Empty State when no keys exist at all ───────────────────
    if (keys.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-card/50 py-16 px-4 text-center font-mono">
                <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground mb-3.5">
                    <KeyRound className="size-5" strokeWidth={1.5} />
                </div>
                <h3 className="text-sm font-bold text-foreground">No API Keys</h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
                    Generate an API key to authenticate requests against SRouter from your client SDKs and applications.
                </p>
                <Button
                    type="button"
                    onClick={onCreateClick}
                    size="sm"
                    className="mt-5 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
                >
                    <Plus className="size-3.5" />
                    <span>Create Key</span>
                </Button>
            </div>
        );
    }

    // ── Key Table when keys exist ─────────────────────────────────────────────
    return (
        <div className="overflow-hidden border border-border/80 bg-card font-mono">
            <div className="flex flex-col justify-between gap-4 border-b border-border/70 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center border border-border/80 bg-secondary text-foreground">
                        <KeyRound className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <div>
                        <h2 className="text-xs font-bold tracking-tight text-foreground uppercase">
                            Key Registry
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                             Credentials, limits, and consumption
                        </p>
                    </div>
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="text"
                        placeholder="Search keys, models…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 border-border/70 bg-secondary/20 pl-8 pr-7 font-mono text-xs focus-visible:ring-1"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            aria-label="Clear search"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="border-b border-border/60 bg-secondary/15 text-[10px] uppercase font-mono tracking-[0.14em] text-muted-foreground">
                        <tr>
                            <th className="py-2.5 px-4 font-semibold">Key & Token</th>
                            <th className="py-2.5 px-4 font-semibold">Limits & Balance</th>
                            <th className="py-2.5 px-4 text-right font-semibold">Usage</th>
                            <th className="py-2.5 px-4 text-center font-semibold">Status</th>
                            <th className="py-2.5 px-4 text-right font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                        {filteredKeys.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                                    No keys match "{searchQuery.trim()}"
                                </td>
                            </tr>
                        ) : (
                            filteredKeys.map((k) => {
                            const isCopied = copiedKeyId === k.id;
                            const isDeleting = deletingId === k.id;
                            const quotaLimit = k.quota_limit ?? 0;
                            const usageTokens = k.usage_tokens ?? 0;
                            const creditLimit = k.credit_limit ?? 0;
                            const usageCost = k.usage_cost ?? 0;
                            const rateLimit = k.rate_limit ?? 0;
                            const hasAllowedModels = Boolean(k.allowed_models && k.allowed_models.length > 0);

                            const remainingCredit =
                                creditLimit > 0 ? Math.max(0, creditLimit - usageCost) : null;
                            const creditPercent =
                                creditLimit > 0
                                    ? Math.min(100, Math.round((usageCost / creditLimit) * 100))
                                    : null;

                            const isCompletelyUnlimited =
                                creditLimit <= 0 && quotaLimit <= 0 && rateLimit <= 0 && !hasAllowedModels;

                            return (
                                <tr
                                    key={k.id}
                                    className="hover:bg-secondary/20 transition-colors group"
                                >
                                    {/* 1. Name & Token & Created Date */}
                                    <td className="py-3 px-4 min-w-56">
                                        <div className="font-semibold text-foreground text-[13px]">
                                            {k.name}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <code
                                                onClick={() => void handleCopy(k.key, k.id)}
                                                className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-secondary/60 cursor-pointer transition-colors"
                                                title="Click to copy full key token"
                                            >
                                                {maskKey(k.key)}
                                                {isCopied ? (
                                                    <Check className="size-2.5 text-emerald-500" />
                                                ) : (
                                                    <Copy className="size-2.5 opacity-60" />
                                                )}
                                            </code>
                                            <span className="text-[10px] text-muted-foreground/60">
                                                {new Date(k.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </td>

                                    {/* 2. Limits & Balance (Consolidated smart cell) */}
                                    <td className="py-3 px-4 min-w-48">
                                        {isCompletelyUnlimited ? (
                                            <span className="text-muted-foreground/60 font-mono text-[11px]">
                                                Unlimited
                                            </span>
                                        ) : (
                                            <div className="space-y-1">
                                                {/* Credit balance if active */}
                                                {creditLimit > 0 && (
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className="text-foreground font-semibold text-[11.5px] font-mono cursor-default"
                                                            title={`Credit: $${remainingCredit?.toFixed(2)} left of $${creditLimit.toFixed(2)}`}
                                                        >
                                                            ${remainingCredit?.toFixed(2)}{" "}
                                                            <span className="text-[9.5px] font-normal text-muted-foreground">
                                                                left
                                                            </span>
                                                        </span>
                                                        {creditPercent !== null && (
                                                            <div className="w-12 h-1 rounded-full bg-secondary overflow-hidden border border-border/40">
                                                                <div
                                                                    className="h-full bg-foreground transition-all duration-300"
                                                                    style={{ width: `${creditPercent}%` }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Quota if active */}
                                                {quotaLimit > 0 && (
                                                    <div className="text-[10.5px] text-muted-foreground font-mono">
                                                        Quota: {formatCompactNumber(quotaLimit)} tok
                                                    </div>
                                                )}

                                                {/* Rate limit & models tags */}
                                                {(rateLimit > 0 || hasAllowedModels) && (
                                                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                                        {rateLimit > 0 && (
                                                            <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.2 text-[9.5px] font-mono text-amber-600 dark:text-amber-400">
                                                                {rateLimit} req/m
                                                            </span>
                                                        )}
                                                        {hasAllowedModels && (
                                                            <span
                                                                className="inline-flex items-center rounded border border-border/50 bg-secondary px-1.5 py-0.2 text-[9.5px] font-mono text-muted-foreground cursor-default"
                                                                title={k.allowed_models?.join("\n")}
                                                            >
                                                                {k.allowed_models?.length} models
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </td>

                                    {/* 3. Usage */}
                                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                                        <div
                                            className="font-semibold text-foreground text-[12px] cursor-default"
                                            title={`Recorded Usage: ${usageTokens.toLocaleString()} tokens`}
                                        >
                                            {formatCompactNumber(usageTokens)}{" "}
                                            <span className="text-[10px] text-muted-foreground font-normal">
                                                tok
                                            </span>
                                        </div>
                                        {usageCost > 0 && (
                                            <div className="text-[9.5px] text-muted-foreground/80 font-mono mt-0.5">
                                                ${usageCost.toFixed(2)} spent
                                            </div>
                                        )}
                                    </td>

                                    {/* 4. Status */}
                                    <td className="py-3 px-4 text-center whitespace-nowrap">
                                        {k.enabled ? (
                                            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                                                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                                                Disabled
                                            </span>
                                        )}
                                    </td>

                                    {/* 5. Actions */}
                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => onEditClick(k)}
                                                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                                                title="Edit key and view details"
                                                aria-label={`Edit key ${k.name}`}
                                            >
                                                <Pencil className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isDeleting}
                                                onClick={() => onDeleteClick(k)}
                                                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-30 cursor-pointer"
                                                title="Revoke and delete key"
                                                aria-label={`Revoke key ${k.name}`}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default KeyTable;
