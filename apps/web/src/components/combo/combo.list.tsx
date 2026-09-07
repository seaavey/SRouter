import { useMemo, useState } from "react";
import {
    AlertCircle,
    ArrowRight,
    Brain,
    Check,
    CheckCircle2,
    Copy,
    Eye,
    Layers,
    Pencil,
    Plus,
    Search,
    Terminal,
    Trash2,
    Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "./combo.confirm-dialog";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { ProviderIcon } from "@/components/providers";
import { formatModelDisplayName, getModelCapabilities } from "./combo.dialog";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { FallbackRule } from "@srouter/types";

/* ───────── Types ───────── */

interface ComboListProps {
    fallbacks: FallbackRule[];
    loading: boolean;
    deletingId: string | null;
    onUpdate: (id: string, updates: Partial<FallbackRule>) => Promise<unknown>;
    onDelete: (id: string, opts?: { silent?: boolean }) => Promise<unknown>;
    onAddClick: () => void;
    onEditClick?: (comboName: string, models: string[]) => void;
}

interface GroupedCombo {
    sourceModel: string;
    rules: FallbackRule[];
    anyEnabled: boolean;
}

type StatusFilter = "all" | "active" | "disabled";

/* ───────── Sub-components ───────── */

function StatusFilterTabs({
    value,
    onChange,
    total,
    activeCount,
    pausedCount
}: {
    value: StatusFilter;
    onChange: (v: StatusFilter) => void;
    total: number;
    activeCount: number;
    pausedCount: number;
}) {
    const tabs: { key: StatusFilter; label: string; count: number }[] = [
        { key: "all", label: "All", count: total },
        { key: "active", label: "Active", count: activeCount },
        { key: "disabled", label: "Paused", count: pausedCount }
    ];

    return (
        <div className="flex items-center gap-1">
            {tabs.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    onClick={() => onChange(t.key)}
                    className={cn(
                        "rounded px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer flex items-center gap-1.5",
                        value === t.key
                            ? "bg-foreground text-background font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                >
                    <span>{t.label}</span>
                    <span
                        className={cn(
                            "rounded px-1 py-0.2 text-[9px] tabular-nums font-semibold",
                            value === t.key
                                ? "bg-background/20 text-background"
                                : "bg-secondary text-muted-foreground"
                        )}
                    >
                        {t.count}
                    </span>
                </button>
            ))}
        </div>
    );
}

function ViewModeToggle({
    mode,
    onChange
}: {
    mode: "grouped" | "flat";
    onChange: (m: "grouped" | "flat") => void;
}) {
    return (
        <div className="flex items-center rounded border border-border/80 bg-card p-0.5 text-[10.5px] font-mono shadow-2xs">
            <button
                type="button"
                onClick={() => onChange("grouped")}
                className={cn(
                    "px-2.5 py-0.5 rounded-xs transition-colors cursor-pointer",
                    mode === "grouped"
                        ? "bg-foreground text-background font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                Pipeline View
            </button>
            <button
                type="button"
                onClick={() => onChange("flat")}
                className={cn(
                    "px-2.5 py-0.5 rounded-xs transition-colors cursor-pointer",
                    mode === "flat"
                        ? "bg-foreground text-background font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                Flat Rules
            </button>
        </div>
    );
}

function EmptyState({ onAddClick }: { onAddClick: () => void }) {
    return (
        <Empty className="bg-card/60 p-8 sm:p-10 shadow-2xs">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Layers className="size-5 text-orange-500" />
                </EmptyMedia>
                <EmptyTitle>No Model Combos Yet</EmptyTitle>
                <EmptyDescription>
                    Create a virtual model endpoint that cascades to backup models when the primary
                    hits 429 rate limits or provider outages.
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button
                    type="button"
                    size="sm"
                    onClick={onAddClick}
                    className="h-8 px-4 text-xs font-semibold cursor-pointer shadow-2xs gap-1.5 bg-foreground text-background hover:bg-foreground/90"
                >
                    <Plus className="size-3.5" />
                    <span>Create Combo</span>
                </Button>
            </EmptyContent>
        </Empty>
    );
}

function PipelineStep({
    rule,
    index,
    total,
    deletingId,
    onDelete
}: {
    rule: FallbackRule;
    index: number;
    total: number;
    deletingId: string | null;
    onDelete: (id: string) => void;
}) {
    const targetProviderId = rule.targetModel.includes("/")
        ? rule.targetModel.split("/")[0]!
        : "custom";
    const displayName = formatModelDisplayName(rule.targetModel);
    const { hasVision, hasThinking } = getModelCapabilities(rule.targetModel, displayName);

    return (
        <div className="flex items-center gap-2">
            <div
                className={cn(
                    "flex items-center gap-2 rounded-md border p-2 text-xs font-mono transition-colors",
                    rule.enabled
                        ? "border-border/80 bg-card text-foreground shadow-2xs"
                        : "border-border/40 bg-secondary/30 text-muted-foreground opacity-60"
                )}
            >
                <span
                    className={cn(
                        "flex size-4.5 items-center justify-center rounded text-[10px] font-bold border",
                        index === 0
                            ? "bg-secondary text-foreground border-border/80"
                            : "bg-secondary/60 text-muted-foreground border-border/60"
                    )}
                >
                    {index + 1}
                </span>

                <ProviderIcon providerId={targetProviderId} className="size-3.5" />

                <div className="flex flex-col text-left pr-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate max-w-[160px]">
                            {displayName}
                        </span>
                        {hasVision && <Eye className="size-3 text-muted-foreground/80 shrink-0" />}
                        {hasThinking && <Brain className="size-3 text-muted-foreground/80 shrink-0" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                        {rule.targetModel}
                    </span>
                </div>

                <div className="flex items-center pl-1 border-l border-border/60">
                    <button
                        type="button"
                        disabled={deletingId === rule.id}
                        onClick={() => onDelete(rule.id)}
                        className="p-1 text-muted-foreground hover:text-destructive cursor-pointer rounded transition-colors"
                        title="Remove step"
                    >
                        <Trash2 className="size-3" />
                    </button>
                </div>
            </div>

            {index < total - 1 && (
                <div className="flex items-center px-1 text-muted-foreground/60">
                    <ArrowRight className="size-3.5" />
                </div>
            )}
        </div>
    );
}

function ComboCardHeader({
    group,
    isEnabled,
    isWildcard,
    copied,
    onCopy,
    onEdit,
    onCopyCurl,
    onToggle,
    onDeleteGroup
}: {
    group: GroupedCombo;
    isEnabled: boolean;
    isWildcard: boolean;
    copied: string | null;
    onCopy: (text: string) => void;
    onEdit?: (name: string, models: string[]) => void;
    onCopyCurl: (source: string) => void;
    onToggle: (enabled: boolean) => void;
    onDeleteGroup: () => void;
}) {
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-2.5 border-b border-border/80 bg-secondary/30">
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-foreground font-mono bg-card border border-border/80 px-2 py-0.5 rounded">
                        {group.sourceModel}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={() => onCopy(group.sourceModel)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                    title="Copy combo model ID"
                >
                    {copied === group.sourceModel ? (
                        <Check className="size-3 text-emerald-500" />
                    ) : (
                        <Copy className="size-3" />
                    )}
                </button>

                <span className="text-[11px] text-muted-foreground font-mono">
                    · {group.rules.length} {group.rules.length === 1 ? "step" : "steps"}
                </span>

                {isEnabled ? (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 font-mono">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span>Active</span>
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium font-mono">
                        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                        <span>Paused</span>
                    </span>
                )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {!isWildcard && (
                    <>
                        <button
                            type="button"
                            onClick={() => onCopyCurl(group.sourceModel)}
                            className="inline-flex items-center gap-1 rounded border border-border/80 bg-card hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-2xs"
                            title="Copy cURL snippet"
                        >
                            <Terminal className="size-3" />
                            <span>cURL</span>
                        </button>

                        {onEdit && (
                            <button
                                type="button"
                                onClick={() => onEdit(group.sourceModel, group.rules.map((r) => r.targetModel))}
                                className="inline-flex items-center gap-1 rounded border border-border/80 bg-card hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-2xs"
                                title="Edit combo models"
                            >
                                <Pencil className="size-3" />
                                <span>Edit</span>
                            </button>
                        )}
                    </>
                )}

                <div className="flex items-center gap-1.5 pl-2 border-l border-border/70">
                    <Switch checked={isEnabled} onCheckedChange={(val) => onToggle(val)} />
                </div>

                <button
                    type="button"
                    onClick={onDeleteGroup}
                    className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                    title="Delete entire combo cascade"
                >
                    <Trash2 className="size-3.5" />
                </button>
            </div>
        </div>
    );
}

/* ───────── Main Component ───────── */

export function ComboList({
    fallbacks,
    loading,
    deletingId,
    onUpdate,
    onDelete,
    onAddClick,
    onEditClick
}: ComboListProps) {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
    const [pendingDelete, setPendingDelete] = useState<GroupedCombo | null>(null);

    const { copied, copy } = useCopy();

    const groupedCombos: GroupedCombo[] = useMemo(() => {
        const map = new Map<string, FallbackRule[]>();
        for (const rule of fallbacks) {
            const key = rule.sourceModel;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(rule);
        }

        return Array.from(map.entries()).map(([sourceModel, rules]) => {
            const sorted = [...rules].sort((a, b) => a.priority - b.priority);
            return { sourceModel, rules: sorted, anyEnabled: sorted.some((r) => r.enabled) };
        });
    }, [fallbacks]);

    const query = search.trim().toLowerCase();

    const filteredGroups = useMemo(
        () =>
            groupedCombos.filter((g) => {
                const match =
                    !query ||
                    g.sourceModel.toLowerCase().includes(query) ||
                    g.rules.some((r) => r.targetModel.toLowerCase().includes(query));
                if (!match) return false;
                if (statusFilter === "active") return g.anyEnabled;
                if (statusFilter === "disabled") return !g.anyEnabled;
                return true;
            }),
        [groupedCombos, search, statusFilter]
    );

    const filteredFlat = useMemo(
        () =>
            fallbacks.filter((r) => {
                const match =
                    !query ||
                    r.sourceModel.toLowerCase().includes(query) ||
                    r.targetModel.toLowerCase().includes(query);
                if (!match) return false;
                if (statusFilter === "active") return r.enabled;
                if (statusFilter === "disabled") return !r.enabled;
                return true;
            }),
        [fallbacks, search, statusFilter]
    );

    const handleCopyCurl = (sourceModel: string) => {
        const curl = `curl -X POST http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ***" \\
  -d '{"model": "${sourceModel}","messages": [{"role": "user", "content": "Hello via combo!"}]}'`;
        void copy(curl);
        toast.success(`Copied cURL command for combo "${sourceModel}"`);
    };

    const handleToggleAllInGroup = async (group: GroupedCombo, targetEnabled: boolean) => {
        for (const rule of group.rules) {
            if (rule.enabled !== targetEnabled) {
                await onUpdate(rule.id, { enabled: targetEnabled });
            }
        }
    };

    const handleDeleteAllInGroup = async (group: GroupedCombo) => {
        for (const rule of group.rules) {
            await onDelete(rule.id, { silent: true });
        }
        toast.success(`Combo "${group.sourceModel}" and all ${group.rules.length} steps deleted`);
    };

    const activeCount = groupedCombos.filter((g) => g.anyEnabled).length;
    const pausedCount = groupedCombos.length - activeCount;

    return (
        <section className="space-y-4 font-mono text-left">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-2.5 rounded-lg border border-border/80 shadow-2xs">
                <div className="flex items-center gap-2 flex-wrap">
                    <StatusFilterTabs
                        value={statusFilter}
                        onChange={setStatusFilter}
                        total={groupedCombos.length}
                        activeCount={activeCount}
                        pausedCount={pausedCount}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <ViewModeToggle mode={viewMode} onChange={setViewMode} />

                    <div className="relative w-full sm:w-56">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter combos & models…"
                            className="h-8 pl-8 text-xs font-mono bg-card border-border/80 rounded"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <Empty className="p-12">
                    <EmptyTitle>Loading combo cascade pipelines...</EmptyTitle>
                </Empty>
            ) : fallbacks.length === 0 ? (
                <EmptyState onAddClick={onAddClick} />
            ) : viewMode === "grouped" ? (
                filteredGroups.length === 0 ? (
                    <Empty className="p-8">
                            <EmptyTitle>No combos found matching &ldquo;{search}&rdquo;</EmptyTitle>
                        </Empty>
                ) : (
                    <div className="space-y-3">
                        {filteredGroups.map((group) => {
                            const isEnabled = group.anyEnabled;
                            const isWildcard = group.sourceModel === "*" || group.sourceModel.endsWith("/*");

                            return (
                                <div
                                    key={group.sourceModel}
                                    className={cn(
                                        "rounded-lg border transition-all overflow-hidden font-mono",
                                        isEnabled
                                            ? "border-border/80 bg-card shadow-2xs hover:border-foreground/20"
                                            : "border-border/50 bg-secondary/15 opacity-75"
                                    )}
                                >
                                    <ComboCardHeader
                                        group={group}
                                        isEnabled={isEnabled}
                                        isWildcard={isWildcard}
                                        copied={copied}
                                        onCopy={(text) => void copy(text)}
                                        onEdit={onEditClick}
                                        onCopyCurl={handleCopyCurl}
                                        onToggle={(val) => void handleToggleAllInGroup(group, val)}
                                        onDeleteGroup={() => setPendingDelete(group)}
                                    />

                                    <div className="p-3.5 overflow-x-auto">
                                        <div className="flex items-center gap-2 min-w-max">
                                            {group.rules.map((rule, idx) => (
                                                <PipelineStep
                                                    key={rule.id}
                                                    rule={rule}
                                                    index={idx}
                                                    total={group.rules.length}
                                                    deletingId={deletingId}
                                                    onDelete={onDelete}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                <div className="space-y-2">
                    {filteredFlat.map((rule) => {
                        const isEnabled = rule.enabled;
                        return (
                            <div
                                key={rule.id}
                                className={cn(
                                    "flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-lg border transition-all font-mono",
                                    isEnabled
                                        ? "border-border/80 bg-card shadow-2xs hover:border-foreground/20"
                                        : "border-border/50 bg-secondary/15 opacity-75"
                                )}
                            >
                                <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground border border-border/70">
                                            {rule.sourceModel}
                                        </span>
                                        <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                                        <span className="inline-flex items-center gap-1.5 rounded bg-secondary/60 text-foreground border border-border/80 px-2 py-0.5 text-xs font-semibold">
                                            <Zap className="size-3 text-muted-foreground" />
                                            {rule.targetModel}
                                        </span>
                                        <span className="inline-flex items-center rounded bg-secondary/50 text-muted-foreground px-1.5 py-0.2 text-[9.5px] font-medium border border-border/50">
                                            Priority #{rule.priority}
                                        </span>
                                        {isEnabled ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                                <span>Active</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                                                <span>Paused</span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={isEnabled}
                                            onCheckedChange={(val) => onUpdate(rule.id, { enabled: val })}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={deletingId === rule.id}
                                        onClick={() => onDelete(rule.id)}
                                        className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded"
                                        title="Delete rule"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
                title="Delete entire combo cascade?"
                description={
                    pendingDelete
                        ? `This permanently removes "${pendingDelete.sourceModel}" and its ${pendingDelete.rules.length} steps from the failover pipeline.`
                        : ""
                }
                confirmLabel="Delete combo"
                onConfirm={() => {
                    if (pendingDelete) void handleDeleteAllInGroup(pendingDelete);
                }}
            />
        </section>
    );
}