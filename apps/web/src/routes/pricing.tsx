import { useState, useMemo, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
    AudioLines,
    BadgeDollarSign,
    Bot,
    BrainCircuit,
    Coins,
    Cpu,
    FileText,
    Image,
    RefreshCw,
    Search,
    Unlock,
    Video,
    Wrench
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePricing } from "@/hooks/usePricing";
import { useDebounce } from "@/hooks/useDebounce";
import { PricingSearchSkeleton, PricingSkeleton } from "@/components/skeletons";
import { PricingSummaryMetrics } from "@/components/pricing/pricing.metrics";
import { PricingTable } from "@/components/pricing/pricing.table";
import { ProviderIcon } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { PricingListResponse } from "@srouter/types";

const modalityLabels: Record<string, string> = {
    all: "All Modalities",
    image: "Vision / Image",
    audio: "Audio",
    video: "Video",
    pdf: "PDF / Document"
};

const featureLabels: Record<string, string> = {
    all: "All Features",
    free: "Free Tier Only",
    reasoning: "Reasoning Models",
    tool_call: "Tool Calling",
    open_weights: "Open Weights"
};

const filterLabelOverrides: Record<string, string> = {
    "ai-singapore": "AI Singapore",
    "arcee-ai": "Arcee AI",
    alibaba: "Alibaba",
    anthropic: "Anthropic",
    "bytedance-seed": "ByteDance Seed",
    cohere: "Cohere",
    deepinfra: "DeepInfra",
    deepreinforce: "DeepReinforce",
    deepseek: "DeepSeek",
    google: "Google",
    ibm: "IBM"
};

function formatFilterLabel(value: string): string {
    const override = filterLabelOverrides[value];
    if (override) return override;

    return value
        .split(/[-_]/)
        .map((word) => {
            if (word.toLowerCase() === "ai") return "AI";
            return word ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
        })
        .join(" ");
}

function ProviderFilterLabel({ providerId }: { providerId: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ProviderIcon providerId={providerId} className="size-4" />
            <span className="truncate">{formatFilterLabel(providerId)}</span>
        </span>
    );
}

const familyIcons: Array<[string, ComponentType<{ className?: string }>]> = [
    ["claude", Bot],
    ["gemini", Bot],
    ["gpt", Bot],
    ["llama", Bot],
    ["qwen", Bot],
    ["deepseek-thinking", BrainCircuit],
    ["reasoning", BrainCircuit],
    ["image", Image],
    ["audio", AudioLines],
    ["whisper", AudioLines]
];

function getFamilyIcon(family: string): ComponentType<{ className?: string }> {
    const normalized = family.toLowerCase();
    return familyIcons.find(([prefix]) => normalized.includes(prefix))?.[1] ?? Cpu;
}

function FamilyFilterLabel({ family }: { family: string }) {
    const Icon = getFamilyIcon(family);
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{formatFilterLabel(family)}</span>
        </span>
    );
}

const modalityIcons = {
    image: Image,
    audio: AudioLines,
    video: Video,
    pdf: FileText
};

function ModalityFilterLabel({ modality }: { modality: string }) {
    const Icon = modalityIcons[modality as keyof typeof modalityIcons];
    return (
        <span className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="size-4 shrink-0" />}
            <span className="truncate">{modalityLabels[modality] ?? modality}</span>
        </span>
    );
}

const featureIcons = {
    free: BadgeDollarSign,
    reasoning: BrainCircuit,
    tool_call: Wrench,
    open_weights: Unlock
};

function FeatureFilterLabel({ feature }: { feature: string }) {
    const Icon = featureIcons[feature as keyof typeof featureIcons];
    return (
        <span className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="size-4 shrink-0" />}
            <span className="truncate">{featureLabels[feature] ?? feature}</span>
        </span>
    );
}

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
    const debouncedSearch = useDebounce(search, 150);
    const isSearching = search !== debouncedSearch;

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
        const q = debouncedSearch.trim().toLowerCase();
        return models
            .filter((item) => {
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
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [models, debouncedSearch, providerFilter, familyFilter, modalityFilter, featureFilter]);

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
            <Card className="mx-auto w-full max-w-6xl gap-2 border-destructive/30 bg-destructive/10 p-6 font-mono text-xs text-destructive">
                <EmptyHeader className="items-start">
                    <EmptyTitle className="text-sm">Failed to load pricing catalog</EmptyTitle>
                    <EmptyDescription>
                        {error instanceof Error ? error.message : "Unknown error"}
                    </EmptyDescription>
                </EmptyHeader>
                <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleRefresh()}
                    className="mt-2 text-xs"
                >
                    Try Again
                </Button>
            </Card>
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
                    <Input
                        type="text"
                        placeholder="Search model ID or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                    />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Provider Select */}
                    <Select
                        value={providerFilter}
                        onValueChange={(value) => setProviderFilter(value ?? "all")}
                    >
                        <SelectTrigger className="w-40 text-xs">
                            <SelectValue>
                                {providerFilter === "all" ? (
                                    "All Providers"
                                ) : (
                                    <ProviderFilterLabel providerId={providerFilter} />
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Providers ({providers.length})</SelectItem>
                            {providers.map((p) => (
                                <SelectItem key={p} value={p}>
                                    <ProviderFilterLabel providerId={p} />
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={familyFilter}
                        onValueChange={(value) => setFamilyFilter(value ?? "all")}
                    >
                        <SelectTrigger className="w-36 text-xs">
                            <SelectValue>
                                {familyFilter === "all" ? "All Families" : <FamilyFilterLabel family={familyFilter} />}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Families ({families.length})</SelectItem>
                            {families.map((family) => (
                                <SelectItem key={family} value={family}>
                                    <FamilyFilterLabel family={family} />
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Modality Filter */}
                    <Select
                        value={modalityFilter}
                        onValueChange={(value) => setModalityFilter(value ?? "all")}
                    >
                        <SelectTrigger className="w-36 text-xs">
                            <SelectValue>
                                {modalityFilter === "all" ? "All Modalities" : <ModalityFilterLabel modality={modalityFilter} />}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Modalities</SelectItem>
                            <SelectItem value="image"><ModalityFilterLabel modality="image" /></SelectItem>
                            <SelectItem value="audio"><ModalityFilterLabel modality="audio" /></SelectItem>
                            <SelectItem value="video"><ModalityFilterLabel modality="video" /></SelectItem>
                            <SelectItem value="pdf"><ModalityFilterLabel modality="pdf" /></SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Feature Filter */}
                    <Select
                        value={featureFilter}
                        onValueChange={(value) => setFeatureFilter(value ?? "all")}
                    >
                        <SelectTrigger className="w-36 text-xs">
                            <SelectValue>
                                {featureFilter === "all" ? "All Features" : <FeatureFilterLabel feature={featureFilter} />}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Features</SelectItem>
                            <SelectItem value="free"><FeatureFilterLabel feature="free" /></SelectItem>
                            <SelectItem value="reasoning"><FeatureFilterLabel feature="reasoning" /></SelectItem>
                            <SelectItem value="tool_call"><FeatureFilterLabel feature="tool_call" /></SelectItem>
                            <SelectItem value="open_weights"><FeatureFilterLabel feature="open_weights" /></SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Data Table */}
            {isSearching ? (
                <PricingSearchSkeleton />
            ) : (
                <PricingTable models={filteredModels} />
            )}
        </div>
    );
}
