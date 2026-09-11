import { useState, useMemo, useRef, useEffect, type ComponentType } from "react";
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
    Search,
    Unlock,
    Video,
    Wrench,
    X
} from "lucide-react";
import { usePricing } from "@/hooks/usePricing";
import { useDebounce } from "@/hooks/useDebounce";
import { PricingSkeleton } from "@/components/skeletons";
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

function getFamilyProviderId(family: string): string | null {
    const normalized = family.toLowerCase();

    switch (true) {
        case normalized.includes("claude"):
            return "claude";
        case normalized.includes("gemini"):
            return "gemini";
        case normalized.includes("gpt"):
        case normalized.includes("o1"):
        case normalized.includes("o3"):
            return "openai";
        case normalized.includes("codestral"):
        case normalized.includes("mistral"):
            return "mistral";
        case normalized.includes("command"):
            return "cohere";
        case normalized.includes("deepseek"):
            return "deepseek";
        case normalized.includes("qwen"):
            return "qwen";
        case normalized.includes("llama"):
            return "meta";
        case normalized.includes("grok"):
            return "xai";
        case normalized.includes("kimi"):
        case normalized.includes("moonshot"):
            return "moonshotai";
        case normalized.includes("minimax"):
            return "minimax";
        case normalized.includes("glm"):
        case normalized.includes("zhipu"):
            return "zhipuai";
        case normalized.includes("perplexity"):
        case normalized.includes("sonar"):
            return "perplexity";
        default:
            return null;
    }
}

function FamilyFilterLabel({ family }: { family: string }) {
    const providerId = getFamilyProviderId(family);
    const FallbackIcon = getFamilyIcon(family);

    return (
        <span className="flex min-w-0 items-center gap-2">
            {providerId ? (
                <ProviderIcon providerId={providerId} className="size-4 shrink-0" />
            ) : (
                <FallbackIcon className="size-4 shrink-0" />
            )}
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
    const { data, isLoading, error, refetch } = usePricing();
    const [search, setSearch] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [providerFilter, setProviderFilter] = useState("all");
    const [familyFilter, setFamilyFilter] = useState("all");
    const [modalityFilter, setModalityFilter] = useState("all");
    const [featureFilter, setFeatureFilter] = useState("all");
    const debouncedSearch = useDebounce(search, 100);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (
                e.key === "/" &&
                document.activeElement?.tagName !== "INPUT" &&
                document.activeElement?.tagName !== "TEXTAREA"
            ) {
                e.preventDefault();
                searchInputRef.current?.focus();
            } else if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
                setSearch("");
                searchInputRef.current?.blur();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

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
                            onClick={() => void refetch()}
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
            </header>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-sans">
                <div className="relative flex-1 max-w-lg">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted pointer-events-none" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search model, name, or description… (Press '/' to focus)"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-10 rounded-full border border-hairline-soft bg-field pl-10 pr-10 text-xs font-mono text-ink placeholder:text-text-muted focus:ring-2 focus:ring-ink focus:outline-none transition-colors"
                    />
                    {search ? (
                        <button
                            type="button"
                            onClick={() => {
                                setSearch("");
                                searchInputRef.current?.focus();
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-ink transition-colors cursor-pointer p-0.5"
                            aria-label="Clear search"
                        >
                            <X className="size-3.5" />
                        </button>
                    ) : (
                        <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center rounded border border-hairline-soft bg-canvas px-1.5 font-mono text-[10px] text-text-muted pointer-events-none select-none">
                            /
                        </kbd>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
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
            <PricingTable models={filteredModels} />
        </div>
    );
}
