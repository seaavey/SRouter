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
                if (featureFilter === "free" && (item.cost.input !== 0 || item.cost.output !== 0))
                    return false;
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
            <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 font-sans">
                <div className="flex flex-col gap-4 rounded-3xl border border-destructive/20 bg-destructive/5 p-6 font-sans text-destructive">
                    <EmptyHeader className="items-start">
                        <EmptyTitle className="text-base font-semibold text-destructive">
                            Failed to load pricing catalog
                        </EmptyTitle>
                        <EmptyDescription className="text-xs text-destructive/80 font-mono">
                            {error instanceof Error ? error.message : "Unknown error"}
                        </EmptyDescription>
                    </EmptyHeader>
                    <div>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => void handleRefresh()}
                            className="rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none"
                        >
                            Try Again
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header section */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            Cost & Limits
                        </p>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                        Pricing Catalog.
                    </h1>
                    <p className="mt-1 text-base font-light text-text-muted font-sans">
                        Token pricing, context limits, and capabilities across all catalog models.
                        Cached for instant access.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleRefresh()}
                        disabled={isManualRefreshing}
                        className="h-10 shrink-0 gap-2 rounded-full border border-hairline-soft bg-canvas px-5 text-sm font-semibold text-ink hover:bg-canvas-soft transition-colors cursor-pointer shadow-none"
                    >
                        <RefreshCw
                            className={`size-4 ${isManualRefreshing ? "animate-spin" : ""}`}
                        />
                        <span>Refresh</span>
                    </Button>
                </div>
            </header>

            {/* Metrics */}
            <PricingSummaryMetrics
                totalModels={metrics.total}
                freeModels={metrics.free}
                medianInputPrice={metrics.medianInput}
                medianOutputPrice={metrics.medianOutput}
            />

            {/* Toolbar: Search and Filters */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
                    <Input
                        type="text"
                        placeholder="Search model ID or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-10 rounded-full border border-hairline-soft bg-field pl-10 pr-4 text-xs font-mono text-ink placeholder:text-text-muted focus:ring-2 focus:ring-ink"
                    />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Provider Select */}
                    <Select
                        value={providerFilter}
                        onValueChange={(value) => setProviderFilter(value ?? "all")}
                    >
                        <SelectTrigger className="h-10 rounded-full border border-hairline-soft bg-field px-4 text-xs font-sans text-ink focus:ring-2 focus:ring-ink shadow-none">
                            <SelectValue>
                                {providerFilter === "all" ? (
                                    "All Providers"
                                ) : (
                                    <ProviderFilterLabel providerId={providerFilter} />
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                            alignItemWithTrigger={false}
                            className="rounded-2xl border border-hairline-soft bg-canvas shadow-none"
                        >
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
                        <SelectTrigger className="h-10 rounded-full border border-hairline-soft bg-field px-4 text-xs font-sans text-ink focus:ring-2 focus:ring-ink shadow-none">
                            <SelectValue>
                                {familyFilter === "all" ? (
                                    "All Families"
                                ) : (
                                    <FamilyFilterLabel family={familyFilter} />
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                            alignItemWithTrigger={false}
                            className="rounded-2xl border border-hairline-soft bg-canvas shadow-none"
                        >
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
                        <SelectTrigger className="h-10 rounded-full border border-hairline-soft bg-field px-4 text-xs font-sans text-ink focus:ring-2 focus:ring-ink shadow-none">
                            <SelectValue>
                                {modalityFilter === "all" ? (
                                    "All Modalities"
                                ) : (
                                    <ModalityFilterLabel modality={modalityFilter} />
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                            alignItemWithTrigger={false}
                            className="rounded-2xl border border-hairline-soft bg-canvas shadow-none"
                        >
                            <SelectItem value="all">All Modalities</SelectItem>
                            <SelectItem value="image">
                                <ModalityFilterLabel modality="image" />
                            </SelectItem>
                            <SelectItem value="audio">
                                <ModalityFilterLabel modality="audio" />
                            </SelectItem>
                            <SelectItem value="video">
                                <ModalityFilterLabel modality="video" />
                            </SelectItem>
                            <SelectItem value="pdf">
                                <ModalityFilterLabel modality="pdf" />
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Feature Filter */}
                    <Select
                        value={featureFilter}
                        onValueChange={(value) => setFeatureFilter(value ?? "all")}
                    >
                        <SelectTrigger className="h-10 rounded-full border border-hairline-soft bg-field px-4 text-xs font-sans text-ink focus:ring-2 focus:ring-ink shadow-none">
                            <SelectValue>
                                {featureFilter === "all" ? (
                                    "All Features"
                                ) : (
                                    <FeatureFilterLabel feature={featureFilter} />
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                            alignItemWithTrigger={false}
                            className="rounded-2xl border border-hairline-soft bg-canvas shadow-none"
                        >
                            <SelectItem value="all">All Features</SelectItem>
                            <SelectItem value="free">
                                <FeatureFilterLabel feature="free" />
                            </SelectItem>
                            <SelectItem value="reasoning">
                                <FeatureFilterLabel feature="reasoning" />
                            </SelectItem>
                            <SelectItem value="tool_call">
                                <FeatureFilterLabel feature="tool_call" />
                            </SelectItem>
                            <SelectItem value="open_weights">
                                <FeatureFilterLabel feature="open_weights" />
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Data Table */}
            {isSearching ? <PricingSearchSkeleton /> : <PricingTable models={filteredModels} />}
        </div>
    );
}
