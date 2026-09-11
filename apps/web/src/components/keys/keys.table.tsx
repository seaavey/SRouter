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

    if (keys.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-hairline bg-canvas py-16 px-6 text-center font-sans">
                <div className="flex size-12 items-center justify-center rounded-full bg-canvas-soft text-text-muted mb-4">
                    <KeyRound className="size-5" strokeWidth={1.75} />
                </div>
                <h3 className="text-base font-semibold text-ink font-sans">No API Keys.</h3>
                <p className="mt-1.5 max-w-sm text-xs text-text-muted leading-relaxed font-sans">
                    Generate an API key to authenticate requests against SRouter from your client
                    SDKs and applications.
                </p>
                <Button
                    type="button"
                    onClick={onCreateClick}
                    size="sm"
                    className="mt-5 h-9 gap-2 rounded-full px-4 text-xs font-semibold cursor-pointer shadow-none"
                >
                    <Plus className="size-3.5" />
                    <span>Create Key</span>
                </Button>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas font-sans shadow-none">
            <div className="flex flex-col justify-between gap-4 border-b border-hairline-soft px-6 py-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                        <KeyRound className="size-4" strokeWidth={1.75} />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold tracking-tight text-ink font-sans">
                            Key Registry.
                        </h2>
                        <p className="text-xs text-text-muted font-sans">
                            Credentials, limits, and consumption
                        </p>
                    </div>
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                    <Input
                        type="text"
                        placeholder="Search keys, models…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 rounded-full bg-field pl-9 pr-8 font-mono text-xs border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-muted hover:text-ink transition-colors cursor-pointer"
                            aria-label="Clear search"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="border-b border-hairline-soft bg-canvas-soft text-[11px] uppercase font-mono tracking-wider text-text-muted">
                        <tr>
                            <th className="py-3 px-6 font-semibold">Key & Token</th>
                            <th className="py-3 px-6 font-semibold">Limits & Balance</th>
                            <th className="py-3 px-6 text-right font-semibold">Usage</th>
                            <th className="py-3 px-6 text-center font-semibold">Status</th>
                            <th className="py-3 px-6 text-right font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline-soft">
                        {filteredKeys.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={5}
                                    className="py-10 text-center text-xs text-text-muted font-sans"
                                >
                                    No keys match "{searchQuery.trim()}".
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
                                const hasAllowedModels = Boolean(
                                    k.allowed_models && k.allowed_models.length > 0
                                );

                                const remainingCredit =
                                    creditLimit > 0 ? Math.max(0, creditLimit - usageCost) : null;
                                const creditPercent =
                                    creditLimit > 0
                                        ? Math.min(100, Math.round((usageCost / creditLimit) * 100))
                                        : null;

                                const isCompletelyUnlimited =
                                    creditLimit <= 0 &&
                                    quotaLimit <= 0 &&
                                    rateLimit <= 0 &&
                                    !hasAllowedModels;

                                return (
                                    <tr
                                        key={k.id}
                                        className="hover:bg-canvas-soft/50 transition-colors group"
                                    >
                                        <td className="py-3.5 px-6 min-w-56">
                                            <div className="font-sans font-medium text-ink text-sm">
                                                {k.name}
                                            </div>
                                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleCopy(k.key, k.id)}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-field px-2.5 py-1 font-mono text-xs text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                                                    title="Click to copy full key token"
                                                >
                                                    <span>{maskKey(k.key)}</span>
                                                    {isCopied ? (
                                                        <Check className="size-3 text-emerald-500 shrink-0" />
                                                    ) : (
                                                        <Copy className="size-3 opacity-60 shrink-0" />
                                                    )}
                                                </button>
                                                <span className="font-mono text-xs text-text-muted/70">
                                                    {new Date(k.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-3.5 px-6 min-w-48">
                                            {isCompletelyUnlimited ? (
                                                <span className="text-text-muted/60 font-mono text-xs">
                                                    Unlimited
                                                </span>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {creditLimit > 0 && (
                                                        <div className="flex items-center gap-2.5">
                                                            <span
                                                                className="text-ink font-semibold text-xs font-mono tabular-nums cursor-default"
                                                                title={`Credit: $${remainingCredit?.toFixed(2)} left of $${creditLimit.toFixed(2)}`}
                                                            >
                                                                ${remainingCredit?.toFixed(2)}{" "}
                                                                <span className="text-[10px] font-sans font-normal text-text-muted">
                                                                    left
                                                                </span>
                                                            </span>
                                                            {creditPercent !== null && (
                                                                <div className="w-16 h-1 rounded-full bg-field overflow-hidden border border-hairline-soft">
                                                                    <div
                                                                        className="h-full bg-accent transition-all duration-300"
                                                                        style={{
                                                                            width: `${creditPercent}%`
                                                                        }}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {quotaLimit > 0 && (
                                                        <div className="text-xs text-text-muted font-mono">
                                                            Quota: {formatCompactNumber(quotaLimit)}{" "}
                                                            tok
                                                        </div>
                                                    )}
                                                    {(rateLimit > 0 || hasAllowedModels) && (
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                            {rateLimit > 0 && (
                                                                <span className="inline-flex items-center rounded-full bg-canvas-soft border border-hairline px-2 py-0.5 text-[10px] font-mono text-text-muted">
                                                                    {rateLimit} req/m
                                                                </span>
                                                            )}
                                                            {hasAllowedModels && (
                                                                <span
                                                                    className="inline-flex items-center rounded-full bg-canvas-soft border border-hairline px-2 py-0.5 text-[10px] font-mono text-text-muted cursor-default"
                                                                    title={k.allowed_models?.join(
                                                                        "\n"
                                                                    )}
                                                                >
                                                                    {k.allowed_models?.length}{" "}
                                                                    models
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-6 text-right font-mono tabular-nums whitespace-nowrap">
                                            <div
                                                className="font-semibold text-ink text-xs cursor-default"
                                                title={`Recorded Usage: ${usageTokens.toLocaleString()} tokens`}
                                            >
                                                {formatCompactNumber(usageTokens)}{" "}
                                                <span className="text-[10px] text-text-muted font-normal">
                                                    tok
                                                </span>
                                            </div>
                                            {usageCost > 0 && (
                                                <div className="text-[11px] text-text-muted font-mono mt-0.5">
                                                    ${usageCost.toFixed(2)} spent
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-6 text-center whitespace-nowrap">
                                            {k.enabled ? (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 font-sans">
                                                    <span className="size-1.5 rounded-full bg-emerald-500" />
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-soft px-2.5 py-0.5 text-xs font-medium text-text-muted font-sans">
                                                    <span className="size-1.5 rounded-full bg-text-muted/50" />
                                                    Disabled
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-6 text-right whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onEditClick(k)}
                                                    className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                                                    title="Edit key and view details"
                                                    aria-label={`Edit key ${k.name}`}
                                                >
                                                    <Pencil className="size-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isDeleting}
                                                    onClick={() => onDeleteClick(k)}
                                                    className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-30 cursor-pointer"
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
