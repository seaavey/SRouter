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
import {
    AddModelDialog,
    ConnectOAuthModal,
    ConnectionCard,
    ConnectionForm,
    ProviderIcon,
    ProviderModelCard,
    ProviderModelTable,
    type ConnectionFormInput
} from "@/components/providers";
import { useProvider, type AddConnectionPayload } from "@/hooks/useProvider";
import { useCopy } from "@/hooks/useCopy";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import { ProviderDetailSkeleton } from "@/components/skeletons";
import { CATEGORY_LABELS, getProviderWebsiteUrl } from "@srouter/constants";
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";

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
        deleteModelMutation,
        hiddenModelIds,
        hideModelMutation,
        restoreModelMutation
    } = useProvider(providerId);

    const [modelSearch, setModelSearch] = useState("");
    const [viewMode, setViewMode] = useState<"table" | "grid">("table");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
    const [isAddModelOpen, setIsAddModelOpen] = useState(false);
    const [formError, setFormError] = useState("");
    const { copied, copy } = useCopy();
    const { isFavorite } = useFavorites();

    const deletedModelIds = hiddenModelIds;

    const handleRestoreModel = (modelId: string) => {
        restoreModelMutation.mutate(modelId);
        toast.success(`Model "${modelId}" restored`);
    };

    const handleRestoreMultiple = (modelIds: string[]) => {
        const removeSet = new Set(modelIds);
        for (const modelId of modelIds) restoreModelMutation.mutate(modelId);
        toast.success(`Restored ${modelIds.length} hidden model${modelIds.length > 1 ? "s" : ""}`);
    };

    const handleDeleteModel = (modelId: string) => {
        hideModelMutation.mutate(modelId);
        toast.info(`Model "${modelId}" hidden from list`, {
            action: {
                label: "Undo",
                onClick: () => handleRestoreModel(modelId)
            }
        });
    };

    const handleDeleteMultipleModels = (modelIds: string[]) => {
        for (const modelId of modelIds) hideModelMutation.mutate(modelId);
        toast.info(`Hidden ${modelIds.length} model${modelIds.length > 1 ? "s" : ""} from list`, {
            action: {
                label: "Undo",
                onClick: () => handleRestoreMultiple(modelIds)
            }
        });
    };

    const handleRestoreAllModels = () => {
        const count = deletedModelIds.length;
        for (const modelId of deletedModelIds) restoreModelMutation.mutate(modelId);
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
            base_url: input.base_url || provider.default_base_url || undefined,
            api_key: input.api_key
        };

        setFormError("");
        addMutation.mutate(payload, {
            onSuccess: () => {
                setIsAddOpen(false);
                toast.success("API key connection added successfully");
            },
            onError: (err) => {
                setFormError(err.message || "Failed to add connection");
            }
        });
    };

    const modelsList = provider?.models ?? [];
    const activeModels = useMemo(
        () => modelsList.filter((m) => !deletedModelIds.includes(m.id)),
        [modelsList, deletedModelIds]
    );

    const filteredModels = useMemo(() => {
        const q = modelSearch.trim().toLowerCase();
        if (!q) return activeModels;
        return activeModels.filter((m) => m.id.toLowerCase().includes(q));
    }, [activeModels, modelSearch]);

    const sortedModels = useMemo(() => {
        return [...filteredModels].sort((a, b) => {
            const aFav = isFavorite(a.id) ? 1 : 0;
            const bFav = isFavorite(b.id) ? 1 : 0;
            if (aFav !== bFav) return bFav - aFav;
            return a.id.localeCompare(b.id);
        });
    }, [filteredModels, isFavorite]);

    if (isLoading || !provider) {
        if (!isLoading && error) {
            return (
                <div className="mx-auto flex w-full max-w-7xl flex-col font-sans">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                            <AlertTriangle className="size-5" strokeWidth={1.75} />
                        </div>
                        <h2 className="text-base font-bold text-ink">
                            Failed to load provider details
                        </h2>
                        <p className="mt-1.5 max-w-md text-xs text-text-muted leading-relaxed font-mono">
                            {error instanceof Error ? error.message : "Provider not found."}
                        </p>
                        <div className="mt-5 flex gap-2">
                            <Link to="/providers">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full px-4 h-9 text-xs font-semibold cursor-pointer border-hairline bg-canvas hover:bg-canvas-soft text-ink shadow-none"
                                >
                                    Back to Catalog
                                </Button>
                            </Link>
                            <Button
                                type="button"
                                size="sm"
                                className="rounded-full px-5 h-9 text-xs font-semibold cursor-pointer shadow-none"
                                onClick={() => void refetch()}
                            >
                                Retry
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 font-sans">
            <div>
                <Link
                    to="/providers"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted hover:text-ink transition-colors"
                >
                    <ArrowLeft className="size-3.5" />
                    <span>Back to Providers Catalog</span>
                </Link>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-hairline-soft pb-5">
                <div className="flex items-center gap-3.5">
                    {websiteUrl ? (
                        <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex size-12 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas-soft p-2 hover:border-hairline transition-all cursor-pointer"
                            title={`Open ${provider.name} website (${websiteUrl})`}
                        >
                            <ProviderIcon providerId={provider.id} className="size-6" />
                        </a>
                    ) : (
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas-soft p-2">
                            <ProviderIcon providerId={provider.id} className="size-6" />
                        </div>
                    )}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            {websiteUrl ? (
                                <a
                                    href={websiteUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group inline-flex items-center gap-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-ink hover:opacity-80 transition-opacity cursor-pointer font-sans"
                                    title={`Visit ${provider.name} (${websiteUrl})`}
                                >
                                    <span>{provider.name}.</span>
                                    <ExternalLink className="size-4 text-text-muted group-hover:text-ink transition-colors" />
                                </a>
                            ) : (
                                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink font-sans">
                                    {provider.name}.
                                </h1>
                            )}
                            {activeConnectionsCount > 0 ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                    <span className="size-1.5 rounded-full bg-emerald-500" />
                                    <span>{activeConnectionsCount} Connected</span>
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-soft px-2.5 py-0.5 text-xs text-text-muted font-medium">
                                    <span className="size-1.5 rounded-full bg-text-muted/40" />
                                    <span>Ready</span>
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-text-muted font-mono">
                            Driver ID: <span className="text-ink font-semibold">{provider.id}</span>{" "}
                            ·{" "}
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
                        className="rounded-full px-4 h-9 text-xs font-semibold cursor-pointer gap-1.5 border-hairline bg-canvas hover:bg-canvas-soft text-ink shadow-none"
                    >
                        <Plus className="size-3.5" />
                        <span>Add Model</span>
                    </Button>
                    <Button
                        type="button"
                        onClick={handleAddConnection}
                        className="rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none"
                    >
                        <Plus className="size-3.5" />
                        <span>{provider.requires_oauth ? "Connect Account" : "Add Key"}</span>
                    </Button>
                </div>
            </div>
            {provider.requires_oauth && (
                <div className="flex items-start gap-3 rounded-3xl border border-hairline-soft bg-canvas-soft p-4 text-xs leading-relaxed text-text-muted">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5 text-ink" />
                    <div>
                        <strong className="text-ink">OAuth Token Lifecycle:</strong> SRouter manages
                        token lifecycle and background refresh sweeper automatically for this
                        provider account.
                    </div>
                </div>
            )}
            <ConnectionCard
                providerName={provider.name}
                connections={connections}
                roundRobin={provider.roundRobin ?? false}
                isDeleting={deleteMutation.isPending}
                requiresOAuth={provider.requires_oauth}
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
            <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline-soft pb-3">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h2 className="text-xl font-bold tracking-tight text-ink font-sans">
                                Available Models.
                            </h2>
                            <span className="font-mono text-xs text-text-muted">
                                ({activeModels.length})
                            </span>
                            {deletedModelIds.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleRestoreAllModels}
                                    className="text-xs text-amber-500 hover:text-amber-400 hover:underline cursor-pointer flex items-center gap-1 font-sans"
                                >
                                    <RotateCcw className="size-3" />
                                    <span>Restore {deletedModelIds.length} deleted</span>
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-text-muted mt-0.5 font-sans">
                            Models exposed by {provider.name} and routed through this gateway.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative w-full sm:w-64">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                            <Input
                                type="text"
                                placeholder="Filter model ID…"
                                value={modelSearch}
                                onChange={(e) => setModelSearch(e.target.value)}
                                className="h-9 pl-9 pr-8 font-mono text-xs rounded-full bg-field border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
                            />
                            {modelSearch && (
                                <button
                                    type="button"
                                    onClick={() => setModelSearch("")}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted hover:text-ink transition-colors cursor-pointer"
                                    aria-label="Clear search"
                                >
                                    <X className="size-3" />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center rounded-full border border-hairline-soft bg-field p-0.5">
                            <button
                                type="button"
                                onClick={() => setViewMode("table")}
                                className={`flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
                                    viewMode === "table"
                                        ? "bg-ink text-canvas font-semibold shadow-none"
                                        : "text-text-muted hover:text-ink"
                                }`}
                                title="Table view (Compact)"
                                aria-label="Table view"
                            >
                                <List className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode("grid")}
                                className={`flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
                                    viewMode === "grid"
                                        ? "bg-ink text-canvas font-semibold shadow-none"
                                        : "text-text-muted hover:text-ink"
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
                    <Empty className="p-12">
                        <EmptyTitle>
                            {modelSearch
                                ? `No models matched your search query "${modelSearch}".`
                                : "No models currently available."}
                        </EmptyTitle>
                        {deletedModelIds.length > 0 && (
                            <button
                                type="button"
                                onClick={handleRestoreAllModels}
                                className="inline-flex items-center gap-1 text-xs text-amber-500 hover:underline cursor-pointer font-sans"
                            >
                                <RotateCcw className="size-3" />
                                <span>Restore all {deletedModelIds.length} models</span>
                            </button>
                        )}
                    </Empty>
                ) : viewMode === "table" ? (
                    <ProviderModelTable
                        models={sortedModels}
                        copied={copied}
                        onCopy={(id) => void copy(id)}
                        onDelete={handleDeleteModel}
                        onDeleteMultiple={handleDeleteMultipleModels}
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <ConnectOAuthModal
                provider={provider}
                open={isOAuthModalOpen}
                onOpenChange={setIsOAuthModalOpen}
            />
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
