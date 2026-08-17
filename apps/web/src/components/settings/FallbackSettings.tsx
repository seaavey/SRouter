import { useState } from "react";
import { ArrowRight, Check, GitFork, Plus, ShieldAlert, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useFallbacks } from "@/hooks/useFallbacks";
import type { FallbackRule } from "@srouter/types";

const COMMON_STATUS_CODES = [429, 403, 500, 502, 503, 504];

export function FallbackSettings() {
    const {
        fallbacks,
        loading,
        saving,
        deletingId,
        createFallback,
        updateFallback,
        deleteFallback
    } = useFallbacks();

    const [isAdding, setIsAdding] = useState(false);
    const [sourceModel, setSourceModel] = useState("");
    const [targetModel, setTargetModel] = useState("");
    const [priority, setPriority] = useState(1);
    const [selectedStatuses, setSelectedStatuses] = useState<number[]>([429, 403, 502, 503, 504]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!sourceModel.trim() || !targetModel.trim()) return;

        const res = await createFallback({
            sourceModel: sourceModel.trim(),
            targetModel: targetModel.trim(),
            priority: Number(priority) || 1,
            enabled: true,
            triggerOnStatus: selectedStatuses.length > 0 ? selectedStatuses : undefined
        });

        if (res) {
            setSourceModel("");
            setTargetModel("");
            setPriority(1);
            setSelectedStatuses([429, 403, 502, 503, 504]);
            setIsAdding(false);
        }
    };

    const toggleStatus = (code: number) => {
        setSelectedStatuses((prev) =>
            prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
        );
    };

    return (
        <div className="rounded-xl border border-border/80 bg-card p-5 space-y-6 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <GitFork className="size-4 text-foreground" />
                        <h2 className="text-sm font-bold text-foreground tracking-tight">
                            Smart Fallback Cascades
                        </h2>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Configure cross-provider routing fallbacks when primary endpoints trigger
                        rate limits, quota exhaustion, or gateway timeouts.
                    </p>
                </div>
                {!isAdding && (
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => setIsAdding(true)}
                        className="h-8 text-xs font-semibold gap-1.5 cursor-pointer self-start sm:self-auto"
                    >
                        <Plus className="size-3.5" />
                        <span>Add Fallback Rule</span>
                    </Button>
                )}
            </div>

            {/* Architecture Explainer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <span>Tier 1: Account Health</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Circuit breaker tracks per-account health and distributes traffic across
                        connected keys.
                    </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <span className="size-2 rounded-full bg-sky-500" />
                        <span>Tier 2: Account Failover</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        If Account 1 encounters 429 quota exhaustion, Account 2 is tried
                        transparently.
                    </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <span className="size-2 rounded-full bg-amber-500" />
                        <span>Tier 3: Provider Cascade</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        If all provider accounts fail, requests re-route to configured fallback
                        models below.
                    </p>
                </div>
            </div>

            {/* Add New Rule Form */}
            {isAdding && (
                <form
                    onSubmit={handleCreate}
                    className="rounded-lg border border-border/90 bg-muted/30 p-4 space-y-4 shadow-2xs"
                >
                    <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                        <span className="text-xs font-bold text-foreground">
                            Create Smart Fallback Rule
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                Source Model / Pattern
                            </label>
                            <Input
                                value={sourceModel}
                                onChange={(e) => setSourceModel(e.target.value)}
                                placeholder="e.g. openai_codex/gpt-4o or openai_codex/* or *"
                                className="h-8 text-xs font-mono"
                                required
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Supports exact model ID, prefix wildcard (e.g.{" "}
                                <code className="text-foreground">openai_codex/*</code>), or global{" "}
                                <code className="text-foreground">*</code>.
                            </p>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                Target Fallback Model
                            </label>
                            <Input
                                value={targetModel}
                                onChange={(e) => setTargetModel(e.target.value)}
                                placeholder="e.g. antigravity/gemini-2.5-pro or claude-3-7-sonnet"
                                className="h-8 text-xs font-mono"
                                required
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Destination model to route to when the source encounters errors.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                Cascade Priority
                            </label>
                            <Input
                                type="number"
                                min={1}
                                max={99}
                                value={priority}
                                onChange={(e) => setPriority(Number(e.target.value))}
                                className="h-8 text-xs font-mono"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Lower number executes first (e.g. 1 before 2).
                            </p>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                Trigger on HTTP Status Codes
                            </label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                                {COMMON_STATUS_CODES.map((code) => {
                                    const selected = selectedStatuses.includes(code);
                                    return (
                                        <button
                                            key={code}
                                            type="button"
                                            onClick={() => toggleStatus(code)}
                                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono font-medium transition-colors cursor-pointer border ${
                                                selected
                                                    ? "bg-foreground text-background border-foreground font-bold"
                                                    : "bg-muted/40 text-muted-foreground border-border/80 hover:text-foreground"
                                            }`}
                                        >
                                            {selected && <Check className="size-3" />}
                                            <span>{code}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsAdding(false)}
                            className="h-8 text-xs cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={saving}
                            className="h-8 text-xs font-semibold cursor-pointer"
                        >
                            {saving ? "Saving..." : "Save Fallback Rule"}
                        </Button>
                    </div>
                </form>
            )}

            {/* Rules List */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                        Active Fallback Rules ({fallbacks.length})
                    </span>
                </div>

                {loading ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                        Loading fallback rules...
                    </div>
                ) : fallbacks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/80 bg-muted/10 p-6 text-center space-y-2">
                        <ShieldAlert className="size-6 text-muted-foreground mx-auto" />
                        <div className="text-xs font-medium text-foreground">
                            No custom fallback rules configured
                        </div>
                        <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                            Add fallback rules to automatically reroute traffic across providers
                            when primary endpoints become unavailable.
                        </p>
                    </div>
                ) : (
                    <div className="rounded-lg border border-border/80 divide-y divide-border/60 bg-muted/10 overflow-hidden">
                        {fallbacks.map((rule: FallbackRule) => (
                            <div
                                key={rule.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-mono font-bold text-foreground border border-border/60">
                                            {rule.sourceModel}
                                        </span>
                                        <ArrowRight className="size-3.5 text-muted-foreground" />
                                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2 py-0.5 text-xs font-mono font-bold">
                                            <Zap className="size-3" />
                                            {rule.targetModel}
                                        </span>
                                        <span className="inline-flex items-center rounded-full bg-muted/80 text-muted-foreground px-2 py-0.2 text-[10px] font-mono font-semibold">
                                            Priority {rule.priority}
                                        </span>
                                    </div>

                                    {rule.triggerOnStatus && rule.triggerOnStatus.length > 0 && (
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                            <span>Triggers on:</span>
                                            {rule.triggerOnStatus.map((code) => (
                                                <span
                                                    key={code}
                                                    className="rounded bg-muted/60 px-1.5 py-0.2 font-mono text-foreground font-medium"
                                                >
                                                    {code}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 self-end sm:self-center">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-muted-foreground">
                                            {rule.enabled ? "Enabled" : "Disabled"}
                                        </span>
                                        <Switch
                                            checked={rule.enabled}
                                            onCheckedChange={(val) =>
                                                updateFallback(rule.id, { enabled: val })
                                            }
                                        />
                                    </div>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={deletingId === rule.id}
                                        onClick={() => deleteFallback(rule.id)}
                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
