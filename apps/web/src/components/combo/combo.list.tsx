import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
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
    Play,
    Plus,
    Search,
    Terminal,
    Trash2,
    Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
    onDelete: (id: string) => Promise<unknown>;
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
        <div className="flex items-center gap-1 border-l border-border/60 pl-2">
            {tabs.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    onClick={() => onChange(t.key)}
                    className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                        value === t.key && t.key === "active" && "bg-emerald-500/20 text-emerald-500 font-bold",
                        value === t.key && t.key === "disabled" && "bg-secondary text-foreground font-bold",
                        value === t.key && t.key === "all" && "bg-foreground text-background",
                        value !== t.key && "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                >
                    {t.label} ({t.count})
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
        <div className="flex items-center rounded-lg border border-border/70 bg-secondary/30 p-0.5 text-[10px] font-semibold">
            <button
                type="button"
                onClick={() => onChange("grouped")}
                className={cn(
                    "px-2 py-1 rounded-md transition-all cursor-pointer",
                    mode === "grouped"
                        ? "bg-background text-foreground shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                Pipeline View
            </button>
            <button
                type="button"
                onClick={() => onChange("flat")}
                className={cn(
                    "px-2 py-1 rounded-md transition-all cursor-pointer",
                    mode === "flat"
                        ? "bg-background text-foreground shadow-2xs font-bold"
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
        <div className="rounded-xl border border-dashed border-border/80 bg-card/60 p-8 sm:p-10 space-y-5 shadow-2xs text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-secondary/80 text-foreground mx-auto">
                <Layers className="size-5 text-orange-500" />
            </div>
            <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-foreground">No Model Combos Yet</h3>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                    Create a virtual model endpoint that cascades to backup models when the primary
                    hits 429 rate limits or provider outages.
                </p>
            </div>
            <Button
                type="button"
                size="sm"
                onClick={onAddClick}
                className="h-8 px-4 text-xs font-semibold cursor-pointer shadow-2xs gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            >
                <Plus className="size-3.5" />
                <span>Create Combo</span>
            </Button>
        </div>
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
        <div className="flex items-center gap-2.5">
            <div
                className={cn(
                    "flex items-center gap-2 rounded-xl border p-2.5 transition-all",
                    rule.enabled
                        ? "border-border/80 bg-secondary/30 text-foreground"
                        : "border-border/40 bg-secondary/10 text-muted-foreground opacity-60"
                )}
            >
                <span
                    className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
                        index === 0
                            ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                            : "bg-secondary text-muted-foreground border border-border/60"
                    )}
                >
                    {index + 1}
                </span>

                <ProviderIcon providerId={targetProviderId} className="size-4" />

                <div className="flex flex-col text-left pr-1">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground">{displayName}</span>
                        {hasVision && <Eye className="size-3 text-sky-400" />}
                        {hasThinking && <Brain className="size-3 text-amber-400" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">{rule.targetModel}</span>
                </div>

                <div className="flex items-center gap-1 pl-1 border-l border-border/50">
                    <button
                        type="button"
                        disabled={deletingId === rule.id}
                        onClick={() => onDelete(rule.id)}
                        className="p-1 text-muted-foreground hover:text-rose-500 cursor-pointer"
                        title="Remove step"
                    >
                        <Trash2 className="size-3" />
                    </button>
                </div>
            </div>

            {index < total - 1 && (
                <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <ArrowRight className="size-4 text-orange-400/80" />
                    <span className="text-[9px] font-mono text-muted-foreground">on 429/5xx</span>
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-secondary/20">
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <Layers className="size-4 text-orange-500" />
                    <span className="font-bold text-xs text-foreground font-mono bg-secondary/80 border border-border/80 px-2 py-0.5 rounded-md">
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
                        <Check className="size-3 text-emerald-400" />
                    ) : (
                        <Copy className="size-3" />
                    )}
                </button>

                <span className="text-[11px] text-muted-foreground">
                    &bull; {group.rules.length} {group.rules.length === 1 ? "step" : "steps"} in cascade
                </span>

                {isEnabled ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.2 rounded-full">
                        <CheckCircle2 className="size-3" />
                        <span>Active</span>
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-secondary px-2 py-0.2 rounded-full">
                        <AlertCircle className="size-3" />
                        <span>Paused</span>
                    </span>
                )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {!isWildcard && (
                    <>
                        <Link
                            to="/playground"
                            search={{ model: group.sourceModel }}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground transition-all cursor-pointer shadow-2xs"
                        >
                            <Play className="size-3 text-emerald-500 fill-emerald-500" />
                            <span>Test</span>
                        </Link>

                        <button
                            type="button"
                            onClick={() => onCopyCurl(group.sourceModel)}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs"
                            title="Copy cURL snippet"
                        >
                            <Terminal className="size-3" />
                            <span>cURL</span>
                        </button>

                        {onEdit && (
                            <button
                                type="button"
                                onClick={() => onEdit(group.sourceModel, group.rules.map((r) => r.targetModel))}
                                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs"
                                title="Edit combo models"
                            >
                                <Pencil className="size-3" />
                                <span>Edit</span>
                            </button>
                        )}
                    </>
                )}

                <div className="flex items-center gap-1.5 pl-2 border-l border-border/60">
                    <Switch checked={isEnabled} onCheckedChange={(val) => onToggle(val)} />
                </div>

                <button
                    type="button"
                    onClick={onDeleteGroup}
                    className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
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
        if (!window.confirm(`Delete entire combo cascade "${group.sourceModel}" (${group.rules.length} steps)?`)) return;
        for (const rule of group.rules) {
            await onDelete(rule.id);
        }
    };

    const activeCount = groupedCombos.filter((g) => g.anyEnabled).length;
    const pausedCount = groupedCombos.length - activeCount;

    return (
        <section className="space-y-4 font-mono text-left">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border/80 shadow-2xs">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground mr-1">
                        <Layers className="size-3.5 text-muted-foreground" />
                        <span>Configured Cascades</span>
                        <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
                            {viewMode === "grouped" ? groupedCombos.length : fallbacks.length}
                        </span>
                    </div>

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
                            placeholder="Search combos..."
                            className="h-8 pl-8 text-xs font-mono bg-background"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div className="rounded-xl border border-border/80 bg-card p-12 text-center text-xs text-muted-foreground animate-pulse">
                    Loading combo cascade pipelines...
                </div>
            ) : fallbacks.length === 0 ? (
                <EmptyState onAddClick={onAddClick} />
            ) : viewMode === "grouped" ? (
                filteredGroups.length === 0 ? (
                    <div className="rounded-xl border border-border/80 bg-card p-8 text-center text-xs text-muted-foreground">
                        No combos found matching &ldquo;{search}&rdquo;
                    </div>
                ) : (
                    <div className="space-y-3.5">
                        {filteredGroups.map((group) => {
                            const isEnabled = group.anyEnabled;
                            const isWildcard = group.sourceModel === "*" || group.sourceModel.endsWith("/*");

                            return (
                                <div
                                    key={group.sourceModel}
                                    className={cn(
                                        "rounded-xl border transition-all overflow-hidden",
                                        isEnabled
                                            ? "border-border/80 bg-card shadow-2xs hover:border-border"
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
                                        onDeleteGroup={() => void handleDeleteAllInGroup(group)}
                                    />

                                    <div className="p-4 overflow-x-auto">
                                        <div className="flex items-center gap-2.5 min-w-max">
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
                <div className="space-y-2.5">
                    {filteredFlat.map((rule) => {
                        const isEnabled = rule.enabled;
                        return (
                            <div
                                key={rule.id}
                                className={cn(
                                    "flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border transition-all",
                                    isEnabled
                                        ? "border-border/80 bg-card shadow-2xs hover:border-border"
                                        : "border-border/50 bg-secondary/15 opacity-75"
                                )}
                            >
                                <div className="space-y-2 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center rounded-md bg-secondary px-2.5 py-1 text-xs font-bold text-foreground border border-border/70 shadow-2xs">
                                            {rule.sourceModel}
                                        </span>
                                        <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold shadow-2xs">
                                            <Zap className="size-3" />
                                            {rule.targetModel}
                                        </span>
                                        <span className="inline-flex items-center rounded-full bg-secondary/80 text-muted-foreground px-2 py-0.5 text-[10px] font-semibold border border-border/50">
                                            Priority #{rule.priority}
                                        </span>
                                        {isEnabled ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
                                                <CheckCircle2 className="size-3" />
                                                <span>Active</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                                                <AlertCircle className="size-3" />
                                                <span>Paused</span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 self-end md:self-center shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] text-muted-foreground font-medium">
                                            {isEnabled ? "Enabled" : "Disabled"}
                                        </span>
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
                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
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
        </section>
    );
}