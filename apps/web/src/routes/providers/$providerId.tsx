import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
    AlertTriangle,
    ArrowLeft,
    ExternalLink,
    LayoutGrid,
    List,
    Plus,
    RotateCcw,
    Search,
    X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderIcon } from "@/components/ProviderIcon";
import { ConnectOAuthModal } from "@/components/providers/ConnectOAuthModal";
import { useProvider, type AddConnectionPayload } from "@/hooks/useProvider";
import { useCopy } from "@/hooks/useCopy";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import { ConnectionCard } from "@/components/providers/ConnectionCard";
import { ConnectionForm, type ConnectionFormInput } from "@/components/providers/ConnectionForm";
import { AddModelDialog } from "@/components/providers/AddModelDialog";
import { ProviderModelCard } from "@/components/providers/ProviderModelCard";
import { ProviderModelTable } from "@/components/providers/ProviderModelTable";
import { ProviderDetailSkeleton } from "@/components/skeletons";
import { CATEGORY_LABELS, getProviderWebsiteUrl } from "@srouter/constants";

export const Route = createFileRoute("/providers/$providerId")({
    staticData: { title: "Providers" },
    component: ProviderDetailPage
});

function ProviderDetailPage() {
    const { providerId } = Route.useParams();
    const {
        data: provider,
        isLoading,
        error,
        refetch,
        addMutation,
        deleteMutation,
        toggleRoundRobinMutation,
        addModelMutation,
        deleteModelMutation
    } = useProvider(providerId);

    const [modelSearch, setModelSearch] = useState("");
    const [viewMode, setViewMode] = useState<"table" | "grid">("table");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
    const [isAddModelOpen, setIsAddModelOpen] = useState(false);
    const [formError, setFormError] = useState("");
    const { copied, copy } = useCopy();
    const { isFavorite } = useFavorites();

    const storageKey = `srouter_deleted_models_${providerId}`;
    const [deletedModelIds, setDeletedModelIds] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    const handleRestoreModel = (modelId: string) => {
        setDeletedModelIds((prev) => {
            const updated = prev.filter((id) => id !== modelId);
            try {
                localStorage.setItem(storageKey, JSON.stringify(updated));
            } catch {}
            return updated;
        });
        toast.success(`Model "${modelId}" restored`);
    };

    const handleRestoreMultiple = (modelIds: string[]) => {
        const removeSet = new Set(modelIds);
        setDeletedModelIds((prev) => {
            const updated = prev.filter((id) => !removeSet.has(id));
            try {
                localStorage.setItem(storageKey, JSON.stringify(updated));
            } catch {}
            return updated;
        });
        toast.success(`Restored ${modelIds.length} hidden model${modelIds.length > 1 ? "s" : ""}`);
    };

    const handleDeleteModel = (modelId: string) => {
        setDeletedModelIds((prev) => {
            const updated = prev.includes(modelId) ? prev : [...prev, modelId];
            try {
                localStorage.setItem(storageKey, JSON.stringify(updated));
            } catch {}
            return updated;
        });
        toast.info(`Model "${modelId}" hidden from list`, {
            action: {
                label: "Undo",
                onClick: () => handleRestoreModel(modelId)
            }
        });
    };

    const handleDeleteMultipleModels = (modelIds: string[]) => {
        setDeletedModelIds((prev) => {
            const set = new Set([...prev, ...modelIds]);
            const updated = Array.from(set);
            try {
                localStorage.setItem(storageKey, JSON.stringify(updated));
            } catch {}
            return updated;
        });
        toast.info(`Hidden ${modelIds.length} model${modelIds.length > 1 ? "s" : ""} from list`, {
            action: {
                label: "Undo",
                onClick: () => handleRestoreMultiple(modelIds)
            }
        });
    };

    const handleRestoreAllModels = () => {
        const count = deletedModelIds.length;
        setDeletedModelIds([]);
        try {
            localStorage.removeItem(storageKey);
        } catch {}
        toast.success(`Restored ${count} hidden model${count > 1 ? "s" : ""}`);
    };

    const handleAddConnection = () => {
        if (provider?.requires_oauth) {
            setIsOAuthModalOpen(true);
        } else {
            setIsAddOpen(true);
        }
    };

    const handleAddSubmit = (input: ConnectionFormInput) => {
        if (!provider) return;

        const payload: AddConnectionPayload = {
            id: `${provider.id}-${Date.now()}`,
            name: input.name?.trim() || `${provider.name} Key`,
            category: provider.category,
            protocol: provider.protocol,
            base_url: input.base_url || input.baseUrl || provider.default_base_url || undefined,
            api_key: input.apiKey
        };

        setFormError("");
        addMutation.mutate(payload, {
            onSuccess: () => {
                setIsAddOpen(false);
                setFormError("");
                toast.success(`API Key for ${provider.name} saved successfully!`);
            },
            onError: (err: Error) => {
                const msg = err.message || "Failed to add connection";
                setFormError(msg);
                toast.error(msg);
            }
        });
    };

    const activeModels = useMemo(() => {
        if (!provider?.models) return [];
        return provider.models.filter((m) => !deletedModelIds.includes(m.id));
    }, [provider?.models, deletedModelIds]);

    const filteredModels = useMemo(() => {
        return activeModels.filter((m) => m.id.toLowerCase().includes(modelSearch.toLowerCase()));
    }, [activeModels, modelSearch]);

    const sortedModels = useMemo(() => {
        return [...filteredModels].sort((a, b) => {
            const favA = isFavorite(a.id) ? 1 : 0;
            const favB = isFavorite(b.id) ? 1 : 0;
            if (favA !== favB) return favB - favA;
            return a.id.localeCompare(b.id);
        });
    }, [filteredModels, isFavorite]);

    if (isLoading || !provider) {
        if (!provider && error) {
            return (
                <div className="mx-auto flex w-full max-w-7xl flex-col font-mono">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                            <AlertTriangle className="size-5" strokeWidth={1.75} />
                        </div>
                        <h2 className="text-sm font-bold text-foreground">Provider not found</h2>
                        <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
                            {error instanceof Error
                                ? error.message
                                : `Unable to find driver configuration for "${providerId}".`}
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs cursor-pointer"
                                onClick={() => void refetch()}
                            >
                                Retry
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                className="h-8 text-xs cursor-pointer"
                                render={<Link to="/providers" />}
                            >
                                Back to Catalog
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }
        return <ProviderDetailSkeleton />;
    }

    const connections = provider.connections ?? [];
    const activeConnectionsCount = connections.filter((c) => c.enabled).length;
    const websiteUrl = getProviderWebsiteUrl(provider.id, provider.default_base_url);

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Top Navigation Back Link */}
            <div>
                <Link
                    to="/providers"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="size-3.5" />
                    <span>Back to Providers Catalog</span>
                </Link>
            </div>

            {/* Editorial Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
                <div className="flex items-center gap-3">
                    {websiteUrl ? (
                        <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card p-2 shadow-2xs hover:border-border hover:bg-secondary/40 transition-all cursor-pointer"
                            title={`Open ${provider.name} website (${websiteUrl})`}
                        >
                            <ProviderIcon providerId={provider.id} className="size-7" />
                        </a>
                    ) : (
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
                            <ProviderIcon providerId={provider.id} className="size-7" />
                        </div>
                    )}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            {websiteUrl ? (
                                <a
                                    href={websiteUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group inline-flex items-center gap-1.5 text-xl font-bold tracking-tight text-foreground hover:text-amber-500 transition-colors cursor-pointer"
                                    title={`Visit ${provider.name} (${websiteUrl})`}
                                >
                                    <span>{provider.name}</span>
                                    <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-amber-500 transition-colors" />
                                </a>
                            ) : (
                                <h1 className="text-xl font-bold tracking-tight text-foreground">
                                    {provider.name}
                                </h1>
                            )}
                            {activeConnectionsCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    <span>{activeConnectionsCount} Connected</span>
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Driver ID: <span className="text-foreground">{provider.id}</span> ·{" "}
                            {CATEGORY_LABELS[provider.category as keyof typeof CATEGORY_LABELS] ??
                                provider.category}
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsAddModelOpen(true)}
                        className="h-8 text-xs font-semibold cursor-pointer shadow-xs gap-1.5"
                    >
                        <Plus className="size-3.5" />
                        <span>Add Model</span>
                    </Button>
                    <Button
                        type="button"
                        onClick={handleAddConnection}
                        className="h-8 text-xs font-semibold cursor-pointer shadow-xs gap-1.5"
                    >
                        <Plus className="size-3.5" />
                        <span>{provider.requires_oauth ? "Connect Account" : "Add Key"}</span>
                    </Button>
                </div>
            </div>

            {/* Risk Notice Alert Banner if OAuth */}
            {provider.requires_oauth && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-500" />
                    <div>
                        <strong>OAuth Refresh Notice:</strong> SRouter manages token lifecycle and
                        background refresh sweeper automatically for this provider account.
                    </div>
                </div>
            )}

            {/* Credentials Card */}
            <ConnectionCard
                providerName={provider.name}
                connections={connections}
                roundRobin={provider.roundRobin ?? false}
                isDeleting={deleteMutation.isPending}
                onToggleRoundRobin={(enabled) => toggleRoundRobinMutation.mutate(enabled)}
                onRefresh={() => void refetch()}
                onAdd={handleAddConnection}
                onDelete={(connectionId) =>
                    deleteMutation.mutate(connectionId, {
                        onSuccess: () => toast.success("Connection deleted successfully"),
                        onError: (err) => toast.error(err.message || "Failed to delete connection")
                    })
                }
            />

            {/* Available Models Section */}
            <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                Available Models ({activeModels.length})
                            </h2>
                            {deletedModelIds.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleRestoreAllModels}
                                    className="text-[10.5px] text-amber-500 hover:text-amber-400 hover:underline cursor-pointer flex items-center gap-1"
                                >
                                    <RotateCcw className="size-3" />
                                    <span>Restore {deletedModelIds.length} deleted</span>
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Models exposed by {provider.name} and routed through this gateway.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Search Input */}
                        <div className="relative w-full sm:w-60">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder="Filter model ID…"
                                value={modelSearch}
                                onChange={(e) => setModelSearch(e.target.value)}
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

                        {/* View Mode Switcher (Table / Grid) */}
                        <div className="flex items-center rounded-md border border-border/70 bg-secondary/30 p-0.5">
                            <button
                                type="button"
                                onClick={() => setViewMode("table")}
                                className={`flex size-7 items-center justify-center rounded-xs transition-colors cursor-pointer ${
                                    viewMode === "table"
                                        ? "bg-background text-foreground shadow-xs font-semibold"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                                title="Table view (Compact)"
                                aria-label="Table view"
                            >
                                <List className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode("grid")}
                                className={`flex size-7 items-center justify-center rounded-xs transition-colors cursor-pointer ${
                                    viewMode === "grid"
                                        ? "bg-background text-foreground shadow-xs font-semibold"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                                title="Grid view (Cards)"
                                aria-label="Grid view"
                            >
                                <LayoutGrid className="size-3.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {sortedModels.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/80 p-12 text-center text-xs text-muted-foreground space-y-2">
                        <p>
                            {modelSearch
                                ? `No models matched your search query "${modelSearch}".`
                                : "No models currently available."}
                        </p>
                        {deletedModelIds.length > 0 && (
                            <button
                                type="button"
                                onClick={handleRestoreAllModels}
                                className="inline-flex items-center gap-1 text-xs text-amber-500 hover:underline cursor-pointer"
                            >
                                <RotateCcw className="size-3" />
                                <span>Restore all {deletedModelIds.length} models</span>
                            </button>
                        )}
                    </div>
                ) : viewMode === "table" ? (
                    <ProviderModelTable
                        models={sortedModels}
                        copied={copied}
                        onCopy={(id) => void copy(id)}
                        onDelete={handleDeleteModel}
                        onDeleteMultiple={handleDeleteMultipleModels}
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {sortedModels.map((m) => (
                            <ProviderModelCard
                                key={m.id}
                                model={m}
                                copied={copied === m.id}
                                onCopy={(id) => void copy(id)}
                                onDelete={handleDeleteModel}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Add Connection Sheet */}
            <ConnectionForm
                open={isAddOpen}
                onOpenChange={setIsAddOpen}
                providerName={provider.name}
                protocol={provider.protocol}
                defaultBaseUrl={provider.default_base_url}
                isSaving={addMutation.isPending}
                error={formError}
                onSubmit={handleAddSubmit}
            />

            {/* Connect OAuth Modal */}
            <ConnectOAuthModal
                provider={provider}
                open={isOAuthModalOpen}
                onOpenChange={setIsOAuthModalOpen}
            />

            {/* Add Custom Model Dialog */}
            <AddModelDialog
                open={isAddModelOpen}
                onOpenChange={setIsAddModelOpen}
                providerName={provider.name}
                isPending={addModelMutation.isPending}
                onSubmit={(modelId) =>
                    addModelMutation.mutate(modelId, {
                        onSuccess: () => {
                            setIsAddModelOpen(false);
                            toast.success(`Model "${modelId}" added to ${provider.name}`);
                        }
                    })
                }
            />
        </div>
    );
}
