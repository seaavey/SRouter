import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, RefreshCw, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePricing } from "@/hooks/usePricing";
import { PricingSkeleton } from "@/components/skeletons";
import { PricingSummaryMetrics } from "@/components/pricing/pricing.metrics";
import { PricingTable } from "@/components/pricing/pricing.table";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PricingListResponse } from "@srouter/types";

export const Route = createFileRoute("/pricing")({
    staticData: { title: "List Pricing" },
    component: PricingPage
});

function PricingPage() {
    const queryClient = useQueryClient();
    const { data, isLoading, error } = usePricing();
    const [search, setSearch] = useState("");
    const [providerFilter, setProviderFilter] = useState("all");
    const [familyFilter, setFamilyFilter] = useState("all");
    const [modalityFilter, setModalityFilter] = useState("all");
    const [featureFilter, setFeatureFilter] = useState("all");
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);

    const handleRefresh = async () => {
        setIsManualRefreshing(true);
        try {
            const freshData = await api.get<PricingListResponse>("/v1/pricing/models?refresh=true");
            queryClient.setQueryData(["pricing", "models"], freshData);
            toast.success("Pricing catalog refreshed", {
                description: "Loaded fresh model dataset from server."
            });
        } catch {
            toast.error("Failed to refresh pricing catalog");
        } finally {
            setIsManualRefreshing(false);
        }
    };

    const models = data?.data ?? [];

    const providers = useMemo(() => {
        const set = new Set<string>();
        for (const m of models) {
            if (m.provider) set.add(m.provider);
        }
        return Array.from(set).sort();
    }, [models]);

    const families = useMemo(() => {
        const set = new Set<string>();
        for (const model of models) set.add(model.family || "Other");
        return Array.from(set).sort();
    }, [models]);

    const filteredModels = useMemo(() => {
        const q = search.trim().toLowerCase();
        return models.filter((item) => {
            if (q) {
                const matchId = item.id.toLowerCase().includes(q);
                const matchName = item.name.toLowerCase().includes(q);
                const matchDesc = item.description?.toLowerCase().includes(q);
                if (!matchId && !matchName && !matchDesc) return false;
            }

            if (providerFilter !== "all" && item.provider !== providerFilter) {
                return false;
            }

            if (familyFilter !== "all" && (item.family || "Other") !== familyFilter) {
                return false;
            }

            if (modalityFilter !== "all") {
                const hasModality =
                    item.modalities?.input?.includes(modalityFilter) ||
                    item.modalities?.output?.includes(modalityFilter);
                if (!hasModality) return false;
            }

            if (featureFilter === "reasoning" && !item.reasoning) return false;
            if (featureFilter === "tool_call" && !item.tool_call) return false;
            if (featureFilter === "free" && (item.cost.input !== 0 || item.cost.output !== 0)) return false;
            if (featureFilter === "open_weights" && !item.open_weights) return false;

            return true;
        });
    }, [models, search, providerFilter, familyFilter, modalityFilter, featureFilter]);

    // Metrics calculations
    const metrics = useMemo(() => {
        if (models.length === 0) {
            return { total: 0, free: 0, medianInput: 0, medianOutput: 0 };
        }

        const knownPrices = models.filter(
            (model) => model.cost.input !== undefined && model.cost.output !== undefined
        );
        const free = knownPrices.filter(
            (model) => model.cost.input === 0 && model.cost.output === 0
        ).length;
        const inputCosts = knownPrices.map((model) => model.cost.input ?? 0).sort((a, b) => a - b);
        const outputCosts = knownPrices
            .map((model) => model.cost.output ?? 0)
            .sort((a, b) => a - b);
        const median = (values: number[]): number => {
            if (values.length === 0) return 0;
            const middle = Math.floor(values.length / 2);
            if (values.length % 2 === 1) return values[middle] ?? 0;
            return ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
        };

        return {
            total: models.length,
            free,
            medianInput: median(inputCosts),
            medianOutput: median(outputCosts)
        };
    }, [models]);

    if (isLoading && !data) {
        return <PricingSkeleton />;
    }

    if (error || !data) {
        return (
            <div className="mx-auto w-full max-w-6xl space-y-4 font-mono">
                <div className="rounded-[12px] border border-rose-500/30 bg-rose-500/10 p-6 text-xs text-rose-500 space-y-2">
                    <p className="font-bold text-sm">Failed to load pricing catalog</p>
                    <p className="text-muted-foreground">
                        {error instanceof Error ? error.message : "Unknown error"}
                    </p>
                    <Button
                        type="button"
                        onClick={() => void handleRefresh()}
                        className="mt-2 text-xs bg-foreground text-background cursor-pointer"
                    >
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 font-mono pb-12">
            {/* Header section */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Coins className="size-5 text-primary" />
                        List Pricing
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Token pricing, context limits, and capabilities across all catalog models. Cached for instant access.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRefresh()}
                        disabled={isManualRefreshing}
                        className="h-8 text-xs cursor-pointer gap-1.5"
                    >
                        <RefreshCw className={`size-3.5 ${isManualRefreshing ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Metrics */}
            <PricingSummaryMetrics
                totalModels={metrics.total}
                freeModels={metrics.free}
                medianInputPrice={metrics.medianInput}
                medianOutputPrice={metrics.medianOutput}
            />

            {/* Toolbar: Search and Filters */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search model ID or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-8 pl-8 pr-3 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:border-foreground/50 transition-colors"
                    />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Provider Select */}
                    <select
                        value={providerFilter}
                        onChange={(e) => setProviderFilter(e.target.value)}
                        className="h-8 px-2.5 text-xs bg-background border border-border/80 rounded-md text-foreground focus:outline-none"
                    >
                        <option value="all">All Providers ({providers.length})</option>
                        {providers.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>

                    <select
                        value={familyFilter}
                        onChange={(e) => setFamilyFilter(e.target.value)}
                        className="h-8 px-2.5 text-xs bg-background border border-border/80 rounded-md text-foreground focus:outline-none"
                    >
                        <option value="all">All Families ({families.length})</option>
                        {families.map((family) => (
                            <option key={family} value={family}>
                                {family}
                            </option>
                        ))}
                    </select>

                    {/* Modality Filter */}
                    <select
                        value={modalityFilter}
                        onChange={(e) => setModalityFilter(e.target.value)}
                        className="h-8 px-2.5 text-xs bg-background border border-border/80 rounded-md text-foreground focus:outline-none"
                    >
                        <option value="all">All Modalities</option>
                        <option value="image">Vision / Image</option>
                        <option value="audio">Audio</option>
                        <option value="video">Video</option>
                        <option value="pdf">PDF / Document</option>
                    </select>

                    {/* Feature Filter */}
                    <select
                        value={featureFilter}
                        onChange={(e) => setFeatureFilter(e.target.value)}
                        className="h-8 px-2.5 text-xs bg-background border border-border/80 rounded-md text-foreground focus:outline-none"
                    >
                        <option value="all">All Features</option>
                        <option value="free">Free Tier Only</option>
                        <option value="reasoning">Reasoning Models</option>
                        <option value="tool_call">Tool Calling</option>
                        <option value="open_weights">Open Weights</option>
                    </select>
                </div>
            </div>

            {/* Data Table */}
            <PricingTable models={filteredModels} />
        </div>
    );
}
