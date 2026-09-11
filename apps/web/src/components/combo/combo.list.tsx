import { useMemo, useState } from "react";
import {
    ArrowRight,
    Brain,
    Check,
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
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";
import { ProviderIcon } from "@/components/providers";
import { formatModelDisplayName, getModelCapabilities } from "./combo.dialog";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { FallbackRule } from "@srouter/types";

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
        <div className="inline-flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1 font-sans">
            {tabs.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    onClick={() => onChange(t.key)}
                    className={cn(
                        "rounded-full px-3 py-1 text-xs transition-colors cursor-pointer flex items-center gap-1.5",
                        value === t.key
                            ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                            : "text-text-muted hover:text-ink"
                    )}
                >
                    <span>{t.label}</span>
                    <span
                        className={cn(
                            "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-mono font-semibold",
                            value === t.key ? "bg-field text-ink" : "bg-canvas text-text-muted"
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
        <div className="inline-flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1 text-xs font-sans">
            <button
                type="button"
                onClick={() => onChange("grouped")}
                className={cn(
                    "px-3 py-1 rounded-full transition-colors cursor-pointer",
                    mode === "grouped"
                        ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                        : "text-text-muted hover:text-ink"
                )}
            >
                Pipeline View
            </button>
            <button
                type="button"
                onClick={() => onChange("flat")}
                className={cn(
                    "px-3 py-1 rounded-full transition-colors cursor-pointer",
                    mode === "flat"
                        ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                        : "text-text-muted hover:text-ink"
                )}
            >
                Flat Rules
            </button>
        </div>
    );
}

function EmptyState({ onAddClick }: { onAddClick: () => void }) {
    return (
        <Empty className="min-h-56 rounded-3xl border border-dashed border-hairline bg-canvas p-12 shadow-none font-sans">
            <EmptyHeader>
                <EmptyMedia
                    variant="icon"
                    className="size-12 rounded-full border border-hairline-soft bg-canvas-soft mb-2"
                >
                    <Layers className="size-6 text-accent" />
                </EmptyMedia>
                <EmptyTitle className="text-base font-semibold text-ink">
                    No Model Combos Yet
                </EmptyTitle>
                <EmptyDescription className="text-xs text-text-muted font-light max-w-md">
                    Create a virtual model endpoint that cascades to backup models when the primary
                    hits 429 rate limits or provider outages.
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="mt-4">
                <Button
                    type="button"
                    onClick={onAddClick}
                    className="h-10 px-5 rounded-full text-xs font-semibold cursor-pointer shadow-none gap-2 bg-ink text-canvas hover:opacity-90"
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
                    "flex items-center gap-2.5 rounded-2xl border p-2.5 text-xs font-sans transition-colors",
                    rule.enabled
                        ? "border-hairline-soft bg-canvas text-ink shadow-none"
                        : "border-hairline-soft/60 bg-canvas-soft/40 text-text-muted opacity-60"
                )}
            >
                <span
                    className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[10px] font-bold border font-mono",
                        index === 0
                            ? "bg-canvas-soft text-ink border-hairline-soft"
                            : "bg-canvas-soft/60 text-text-muted border-hairline-soft/60"
                    )}
                >
                    {index + 1}
                </span>

                <ProviderIcon providerId={targetProviderId} className="size-4 shrink-0" />

                <div className="flex flex-col text-left pr-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-ink truncate max-w-[160px] font-sans">
                            {displayName}
                        </span>
                        {hasVision && <Eye className="size-3 text-text-muted shrink-0" />}
                        {hasThinking && <Brain className="size-3 text-text-muted shrink-0" />}
                    </div>
                    <span className="text-[10px] text-text-muted truncate max-w-[160px] font-mono mt-0.5">
                        {rule.targetModel}
                    </span>
                </div>

                <div className="flex items-center pl-1.5 border-l border-hairline-soft">
                    <button
                        type="button"
                        disabled={deletingId === rule.id}
                        onClick={() => onDelete(rule.id)}
                        className="size-6 inline-flex items-center justify-center text-text-muted hover:text-destructive cursor-pointer rounded-full hover:bg-destructive/10 transition-colors"
                        title="Remove step"
                    >
                        <Trash2 className="size-3" />
                    </button>
                </div>
            </div>

            {index < total - 1 && (
                <div className="flex items-center px-1 text-text-muted/60">
                    <ArrowRight className="size-4" />
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-b border-hairline-soft bg-canvas-soft/30 font-sans">
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-ink font-mono bg-canvas border border-hairline-soft px-3 py-1 rounded-full">
                        {group.sourceModel}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={() => onCopy(group.sourceModel)}
                    className="rounded-full size-7 inline-flex items-center justify-center text-text-muted hover:text-ink hover:bg-canvas transition-colors cursor-pointer"
                    title="Copy combo model ID"
                >
                    {copied === group.sourceModel ? (
                        <Check className="size-3.5 text-emerald-500" />
                    ) : (
                        <Copy className="size-3.5" />
                    )}
                </button>

                <span className="text-xs text-text-muted font-sans font-light">
                    · {group.rules.length} {group.rules.length === 1 ? "step" : "steps"}
                </span>

                {isEnabled ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 font-sans ml-1">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span>Active</span>
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted font-medium font-sans ml-1">
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
                            className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft px-3 py-1 text-xs font-semibold text-text-muted hover:text-ink transition-colors cursor-pointer shadow-none font-mono"
                            title="Copy cURL snippet"
                        >
                            <Terminal className="size-3" />
                            <span>cURL</span>
                        </button>

                        {onEdit && (
                            <button
                                type="button"
                                onClick={() =>
                                    onEdit(
                                        group.sourceModel,
                                        group.rules.map((r) => r.targetModel)
                                    )
                                }
                                className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft px-3 py-1 text-xs font-semibold text-text-muted hover:text-ink transition-colors cursor-pointer shadow-none font-sans"
                                title="Edit combo models"
                            >
                                <Pencil className="size-3" />
                                <span>Edit</span>
                            </button>
                        )}
                    </>
                )}

                <div className="flex items-center gap-1.5 pl-2 border-l border-hairline-soft">
                    <Switch checked={isEnabled} onCheckedChange={(val) => onToggle(val)} />
                </div>

                <button
                    type="button"
                    onClick={onDeleteGroup}
                    className="size-7 inline-flex items-center justify-center text-text-muted hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors cursor-pointer"
                    title="Delete entire combo cascade"
                >
                    <Trash2 className="size-3.5" />
                </button>
            </div>
        </div>
    );
}

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
        <section className="space-y-4 font-sans text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-canvas p-3 rounded-3xl border border-hairline-soft shadow-none">
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

                    <div className="relative w-full sm:w-60">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter combos & models…"
                            className="h-9 pl-9 pr-4 text-xs font-mono bg-field border-hairline-soft rounded-full text-ink placeholder:text-text-muted focus:ring-2 focus:ring-ink"
                        />
                    </div>
                </div>
            </div>
            {loading ? (
                <Empty className="p-12 rounded-3xl border border-hairline-soft bg-canvas">
                    <EmptyTitle className="text-sm font-sans text-text-muted">
                        Loading combo cascade pipelines...
                    </EmptyTitle>
                </Empty>
            ) : fallbacks.length === 0 ? (
                <EmptyState onAddClick={onAddClick} />
            ) : viewMode === "grouped" ? (
                filteredGroups.length === 0 ? (
                    <Empty className="p-12 rounded-3xl border border-hairline-soft bg-canvas">
                        <EmptyTitle className="text-sm font-sans text-text-muted">
                            No combos found matching &ldquo;{search}&rdquo;
                        </EmptyTitle>
                    </Empty>
                ) : (
                    <div className="space-y-4">
                        {filteredGroups.map((group) => {
                            const isEnabled = group.anyEnabled;
                            const isWildcard =
                                group.sourceModel === "*" || group.sourceModel.endsWith("/*");

                            return (
                                <div
                                    key={group.sourceModel}
                                    className={cn(
                                        "rounded-3xl border transition-all overflow-hidden font-sans",
                                        isEnabled
                                            ? "border-hairline-soft bg-canvas shadow-none hover:border-hairline"
                                            : "border-hairline-soft/60 bg-canvas-soft/30 opacity-75"
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

                                    <div className="p-5 overflow-x-auto">
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
                <div className="space-y-3">
                    {filteredFlat.map((rule) => {
                        const isEnabled = rule.enabled;
                        return (
                            <div
                                key={rule.id}
                                className={cn(
                                    "flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-2xl border transition-all font-sans",
                                    isEnabled
                                        ? "border-hairline-soft bg-canvas shadow-none hover:border-hairline"
                                        : "border-hairline-soft/60 bg-canvas-soft/30 opacity-75"
                                )}
                            >
                                <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center rounded-full bg-canvas-soft px-3 py-1 text-xs font-semibold text-ink border border-hairline-soft font-mono">
                                            {rule.sourceModel}
                                        </span>
                                        <ArrowRight className="size-3.5 text-text-muted shrink-0" />
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas text-ink border border-hairline-soft px-3 py-1 text-xs font-semibold font-mono">
                                            <Zap className="size-3 text-accent" />
                                            {rule.targetModel}
                                        </span>
                                        <span className="inline-flex items-center rounded-full bg-field text-text-muted px-2.5 py-0.5 text-[10px] font-mono font-medium">
                                            Priority #{rule.priority}
                                        </span>
                                        {isEnabled ? (
                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                                <span>Active</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs text-text-muted font-medium">
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
                                            onCheckedChange={(val) =>
                                                onUpdate(rule.id, { enabled: val })
                                            }
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={deletingId === rule.id}
                                        onClick={() => onDelete(rule.id)}
                                        className="size-8 p-0 text-text-muted hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded-full"
                                        title="Delete rule"
                                    >
                                        <Trash2 className="size-4" />
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
