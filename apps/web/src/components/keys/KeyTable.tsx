import { useState, useMemo } from "react";
import { Check, CircleDollarSign, Copy, KeyRound, Plus, Search, Trash2, X } from "lucide-react";
import type { DBAPIKey } from "@srouter/types";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCompactNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KeyFilter = "all" | "active" | "with-credit" | "with-quota" | "with-rate-limit";

type KeyTableProps = {
    keys: DBAPIKey[];
    deletingId: string | null;
    onCreateClick: () => void;
    onAddCreditClick: (key: DBAPIKey) => void;
    onDeleteClick: (key: DBAPIKey) => void;
};

function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}

export function KeyTable({
    keys,
    deletingId,
    onCreateClick,
    onAddCreditClick,
    onDeleteClick
}: KeyTableProps) {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<KeyFilter>("all");
    const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

    const debouncedSearch = useDebounce(search, 150);

    const filteredKeys = useMemo(() => {
        const query = debouncedSearch.trim().toLowerCase();

        return keys.filter((k) => {
            const matchesText =
                !query ||
                k.name.toLowerCase().includes(query) ||
                k.id.toLowerCase().includes(query) ||
                k.key.toLowerCase().includes(query);

            if (!matchesText) return false;

            if (filter === "active") return k.enabled;
            if (filter === "with-credit") return (k.creditLimit ?? 0) > 0;
            if (filter === "with-quota") return (k.quotaLimit ?? 0) > 0;
            if (filter === "with-rate-limit") return (k.rateLimit ?? 0) > 0;

            return true;
        });
    }, [keys, debouncedSearch, filter]);

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedKeyId(id);
            setTimeout(() => setCopiedKeyId(null), 2000);
        } catch {
            // fallback
        }
    };

    // ── Pure, Minimal Empty State when no keys exist at all ───────────────────
    if (keys.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 py-16 px-4 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground mb-3.5">
                    <KeyRound className="size-5" strokeWidth={1.5} />
                </div>
                <h3 className="text-sm font-semibold text-foreground">No API Keys</h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
                    Generate an API key to authenticate requests against SRouter from your client
                    SDKs and applications.
                </p>
                <Button
                    type="button"
                    onClick={onCreateClick}
                    size="sm"
                    className="mt-5 h-8.5 gap-1.5 px-4 text-xs font-semibold cursor-pointer shadow-xs"
                >
                    <Plus className="size-3.5" />
                    <span>Create Key</span>
                </Button>
            </div>
        );
    }

    // ── Key Table with Search & Filter when keys exist ───────────────────────
    return (
        <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-xs">
            {/* Header Toolbar: Search & Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 p-3.5 sm:px-4">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                    {/* Search Input */}
                    <div className="relative w-full sm:w-72">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search keys by name, ID, or token…"
                            className="h-8 pl-8 pr-7 font-mono text-xs rounded-md bg-background"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X className="size-3" />
                            </button>
                        )}
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                        <button
                            type="button"
                            onClick={() => setFilter("all")}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                                filter === "all"
                                    ? "bg-secondary text-foreground font-semibold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            }`}
                        >
                            All ({keys.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("active")}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                                filter === "active"
                                    ? "bg-secondary text-foreground font-semibold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            }`}
                        >
                            Active ({keys.filter((k) => k.enabled).length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("with-credit")}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                                filter === "with-credit"
                                    ? "bg-secondary text-foreground font-semibold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            }`}
                        >
                            With Credit ({keys.filter((k) => (k.creditLimit ?? 0) > 0).length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("with-quota")}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                                filter === "with-quota"
                                    ? "bg-secondary text-foreground font-semibold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            }`}
                        >
                            With Quota ({keys.filter((k) => (k.quotaLimit ?? 0) > 0).length})
                        </button>
                    </div>
                </div>

                <span className="font-mono text-xs text-muted-foreground sm:ml-auto">
                    {filteredKeys.length} {filteredKeys.length === 1 ? "key" : "keys"}
                </span>
            </div>

            {/* Filtered Out Empty Search State */}
            {filteredKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <p className="text-sm font-semibold text-foreground">No matching keys</p>
                    <p className="mt-1 text-xs text-muted-foreground max-w-sm leading-relaxed">
                        No API keys match your search query. Try clearing your search term.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setSearch("");
                            setFilter("all");
                        }}
                        className="mt-3 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
                    >
                        Reset filters
                    </button>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-border/60 bg-secondary/30 text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
                            <tr>
                                <th className="py-2.5 px-4 font-semibold">Key Name & ID</th>
                                <th className="py-2.5 px-4 font-semibold">Secret Key</th>
                                <th className="py-2.5 px-4 text-right font-semibold">Rate Limit</th>
                                <th className="py-2.5 px-4 text-right font-semibold">Credit / Balance</th>
                                <th className="py-2.5 px-4 text-right font-semibold">
                                    Token Quota
                                </th>
                                <th className="py-2.5 px-4 font-semibold">Models</th>
                                <th className="py-2.5 px-4 text-right font-semibold">Tokens</th>
                                <th className="py-2.5 px-4 text-center font-semibold">Status</th>
                                <th className="py-2.5 px-4 text-right font-semibold">Created</th>
                                <th className="py-2.5 px-4 text-right font-semibold">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {filteredKeys.map((k) => {
                                const isCopied = copiedKeyId === k.id;
                                const isDeleting = deletingId === k.id;
                                const quotaLimit = k.quotaLimit ?? 0;
                                const usageTokens = k.usageTokens ?? 0;
                                const creditLimit = k.creditLimit ?? 0;
                                const usageCost = k.usageCost ?? 0;
                                const remainingCredit =
                                    creditLimit > 0 ? Math.max(0, creditLimit - usageCost) : null;
                                const creditPercent =
                                    creditLimit > 0
                                        ? Math.min(100, Math.round((usageCost / creditLimit) * 100))
                                        : null;
                                const quotaPercent =
                                    quotaLimit > 0
                                        ? Math.min(
                                              100,
                                              Math.round((usageTokens / quotaLimit) * 100)
                                          )
                                        : null;

                                return (
                                    <tr
                                        key={k.id}
                                        className="hover:bg-secondary/20 transition-colors group"
                                    >
                                        {/* Name & ID */}
                                        <td className="py-3 px-4">
                                            <div className="font-semibold text-foreground">
                                                {k.name}
                                            </div>
                                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                                {k.id}
                                            </div>
                                        </td>

                                        {/* Secret Key Token with Copy */}
                                        <td className="py-3 px-4">
                                            <div className="flex items-center gap-1.5">
                                                <code className="rounded-md border border-border/60 bg-background px-2 py-0.5 font-mono text-[11px] text-foreground select-all">
                                                    {maskKey(k.key)}
                                                </code>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleCopy(k.key, k.id)}
                                                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                                                    title="Copy full key token"
                                                    aria-label="Copy key token"
                                                >
                                                    {isCopied ? (
                                                        <Check className="size-3 text-emerald-500" />
                                                    ) : (
                                                        <Copy className="size-3" />
                                                    )}
                                                </button>
                                            </div>
                                        </td>

                                        {/* Rate Limit */}
                                        <td className="py-3 px-4 text-right font-mono tabular-nums text-muted-foreground">
                                            {(k.rateLimit ?? 0) > 0 ? (
                                                <span className="text-foreground font-medium">
                                                    {k.rateLimit?.toLocaleString()}{" "}
                                                    <span className="text-[10px] opacity-70">
                                                        req/m
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground/60">
                                                    Unlimited
                                                </span>
                                            )}
                                        </td>

                                        {/* Credit / Balance */}
                                        <td className="py-3 px-4 text-right font-mono tabular-nums text-muted-foreground">
                                            {creditLimit > 0 ? (
                                                <div>
                                                    <span
                                                        className="text-foreground font-semibold text-emerald-500 cursor-default"
                                                        title={`Credit: $${remainingCredit?.toFixed(2)} left of $${creditLimit.toFixed(2)}`}
                                                    >
                                                        ${remainingCredit?.toFixed(2)}{" "}
                                                        <span className="text-[10px] text-muted-foreground font-normal">
                                                            left
                                                        </span>
                                                    </span>
                                                    {creditPercent !== null && (
                                                        <div className="mt-1 flex items-center justify-end gap-1.5 text-[9.5px] text-muted-foreground">
                                                            <div className="w-12 h-1 rounded-full bg-secondary overflow-hidden ring-1 ring-border/30">
                                                                <div
                                                                    className={`h-full transition-all duration-300 ${
                                                                        creditPercent > 90
                                                                            ? "bg-destructive"
                                                                            : creditPercent > 70
                                                                              ? "bg-amber-500"
                                                                              : "bg-emerald-500"
                                                                    }`}
                                                                    style={{
                                                                        width: `${creditPercent}%`
                                                                    }}
                                                                />
                                                            </div>
                                                            <span>{creditPercent}%</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div
                                                    className="cursor-default"
                                                    title={`Spent: $${usageCost.toFixed(3)}`}
                                                >
                                                    <span className="text-muted-foreground/60">
                                                        Unlimited
                                                    </span>
                                                    {usageCost > 0 && (
                                                        <div className="text-[9.5px] text-muted-foreground/80 font-mono mt-0.5">
                                                            ${usageCost.toFixed(2)} spent
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </td>

                                        {/* Quota Limit */}
                                        <td className="py-3 px-4 text-right font-mono tabular-nums text-muted-foreground">
                                            {quotaLimit > 0 ? (
                                                <span
                                                    className="text-foreground font-medium cursor-default"
                                                    title={`Quota: ${quotaLimit.toLocaleString()} tokens`}
                                                >
                                                    {formatCompactNumber(quotaLimit)}{" "}
                                                    <span className="text-[10px] opacity-70">
                                                        tok
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground/60">
                                                    Unlimited
                                                </span>
                                            )}
                                        </td>

                                        {/* Allowed Models Scope */}
                                        <td className="py-3 px-4">
                                            {k.allowed_models && k.allowed_models.length > 0 ? (
                                                <span
                                                    className="inline-flex items-center rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground cursor-default"
                                                    title={k.allowed_models.join("\n")}
                                                >
                                                    {k.allowed_models.length} model
                                                    {k.allowed_models.length === 1 ? "" : "s"}
                                                </span>
                                            ) : (
                                                <span className="font-mono text-[10px] text-muted-foreground/60">
                                                    All
                                                </span>
                                            )}
                                        </td>

                                        {/* Usage Volume & Mini Progress Bar */}
                                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                                            <div
                                                className="font-semibold text-foreground cursor-default"
                                                title={`Recorded Usage: ${usageTokens.toLocaleString()} tokens`}
                                            >
                                                {formatCompactNumber(usageTokens)}{" "}
                                                <span className="text-[10px] text-muted-foreground font-normal">
                                                    tok
                                                </span>
                                            </div>
                                            {quotaPercent !== null && (
                                                <div className="mt-1 flex items-center justify-end gap-1.5 text-[9.5px] text-muted-foreground">
                                                    <div className="w-12 h-1 rounded-full bg-secondary overflow-hidden ring-1 ring-border/30">
                                                        <div
                                                            className={`h-full transition-all duration-300 ${
                                                                quotaPercent > 90
                                                                    ? "bg-destructive"
                                                                    : quotaPercent > 70
                                                                      ? "bg-amber-500"
                                                                      : "bg-emerald-500"
                                                            }`}
                                                            style={{
                                                                width: `${quotaPercent}%`
                                                            }}
                                                        />
                                                    </div>
                                                    <span>{quotaPercent}%</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Status */}
                                        <td className="py-3 px-4 text-center">
                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                <span className="size-1 rounded-full bg-emerald-500" />
                                                Active
                                            </span>
                                        </td>

                                        {/* Created Date */}
                                        <td className="py-3 px-4 text-right font-mono text-muted-foreground tabular-nums">
                                            {new Date(k.createdAt).toLocaleDateString()}
                                        </td>

                                        {/* Action: Add Credit & Revoke / Delete */}
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onAddCreditClick(k)}
                                                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500 transition-colors cursor-pointer"
                                                    title="Add credit / saldo"
                                                    aria-label={`Add credit to key ${k.name}`}
                                                >
                                                    <CircleDollarSign className="size-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isDeleting}
                                                    onClick={() => onDeleteClick(k)}
                                                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 cursor-pointer"
                                                    title="Revoke and delete key"
                                                    aria-label={`Revoke key ${k.name}`}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default KeyTable;
