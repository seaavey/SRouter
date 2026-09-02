import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Eye, Info, Layers, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { ProviderIcon } from "@/components/providers/providers.icon";
import { ANTIGRAVITY_MODELS, KNOWN_PROVIDERS } from "@srouter/constants";
import type { ModelListResponse } from "@srouter/types";

export interface ComboModelItem {
    id: string;
    name: string;
    providerId: string;
    providerName: string;
}

interface ComboModelPickerModalProps {
    open: boolean;
    onClose: () => void;
    selectedModelIds: string[];
    onToggleModel: (model: ComboModelItem) => void;
    existingCombos?: string[];
}

const EMPTY_COMBOS: string[] = [];

const ANTIGRAVITY_STATIC_MODELS: ComboModelItem[] = ANTIGRAVITY_MODELS.map((m) => ({
    id: `antigravity/${m.id}`,
    name: m.name,
    providerId: "antigravity",
    providerName: "Antigravity"
}));

const FALLBACK_PROVIDER_MODELS: Record<string, ComboModelItem[]> = {
    openai_codex: [
        { id: "openai_codex/gpt-4o", name: "GPT-4o", providerId: "openai_codex", providerName: "OpenAI" },
        { id: "openai_codex/gpt-4o-mini", name: "GPT-4o Mini", providerId: "openai_codex", providerName: "OpenAI" },
        { id: "openai_codex/o1", name: "o1", providerId: "openai_codex", providerName: "OpenAI" },
        { id: "openai_codex/o3-mini", name: "o3-mini", providerId: "openai_codex", providerName: "OpenAI" }
    ],
    openai: [
        { id: "openai/gpt-4o", name: "GPT-4o", providerId: "openai", providerName: "OpenAI" },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", providerId: "openai", providerName: "OpenAI" },
        { id: "openai/o1", name: "o1", providerId: "openai", providerName: "OpenAI" },
        { id: "openai/o3-mini", name: "o3-mini", providerId: "openai", providerName: "OpenAI" }
    ],
    anthropic: [
        { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Thinking)", providerId: "anthropic", providerName: "Anthropic" },
        { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerId: "anthropic", providerName: "Anthropic" },
        { id: "anthropic/claude-3-5-haiku", name: "Claude 3.5 Haiku", providerId: "anthropic", providerName: "Anthropic" }
    ]
};

export function getModelCapabilities(modelId: string, modelName?: string) {
    const combined = `${modelId} ${modelName || ""}`.toLowerCase();

    const hasVision =
        combined.includes("vision") ||
        combined.includes("vl") ||
        combined.includes("claude-3") ||
        combined.includes("claude-sonnet") ||
        combined.includes("claude-opus") ||
        combined.includes("gemini") ||
        combined.includes("gpt-4o") ||
        combined.includes("gpt-4-turbo") ||
        combined.includes("multimodal") ||
        combined.includes("omni") ||
        combined.includes("pixtral");

    const hasThinking =
        combined.includes("thinking") ||
        combined.includes("reason") ||
        combined.includes("reasoner") ||
        combined.includes("r1") ||
        combined.includes("o1") ||
        combined.includes("o3") ||
        combined.includes("high") ||
        combined.includes("medium") ||
        combined.includes("low") ||
        combined.includes("gemini-3") ||
        combined.includes("claude-sonnet-4-6") ||
        combined.includes("claude-opus-4-6");

    return { hasVision, hasThinking };
}

export function formatModelDisplayName(rawId: string, rawName?: string): string {
    if (rawName && rawName.trim().length > 0 && rawName !== rawId) {
        return rawName;
    }
    const cleanId = rawId.includes("/") ? rawId.split("/").slice(1).join("/") : rawId;
    const known = ANTIGRAVITY_MODELS.find((m) => m.id === cleanId || m.id === rawId);
    if (known) return known.name;

    if (cleanId === "claude-sonnet-4-6") return "Claude Sonnet 4.6 (Thinking)";
    if (cleanId === "claude-opus-4-6-thinking") return "Claude Opus 4.6 (Thinking)";
    if (cleanId.startsWith("gemini-3.7-flash"))
        return `Gemini 3.7 Flash (${cleanId.split("-").pop()?.toUpperCase() || "High"})`;
    if (cleanId.startsWith("gemini-3.6-flash"))
        return `Gemini 3.6 Flash (${cleanId.split("-").pop()?.toUpperCase() || "High"})`;
    if (cleanId.startsWith("gemini-3.5-flash"))
        return `Gemini 3.5 Flash (${cleanId.split("-").pop()?.toUpperCase() || "High"})`;
    if (cleanId.startsWith("gemini-3.1-pro"))
        return `Gemini 3.1 Pro (${cleanId.split("-").pop()?.toUpperCase() || "High"})`;
    if (cleanId === "gemini-3-flash") return "Gemini 3 Flash";

    return cleanId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ComboModelPickerModal({
    open,
    onClose,
    selectedModelIds,
    onToggleModel,
    existingCombos = EMPTY_COMBOS
}: ComboModelPickerModalProps) {
    const [search, setSearch] = useState("");

    const { data: modelsData } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: open,
        staleTime: 60_000
    });

    const selectedSet = useMemo(() => new Set(selectedModelIds), [selectedModelIds]);

    const groups = useMemo(() => {
        const result: Array<{
            id: string;
            name: string;
            isCombo?: boolean;
            models: ComboModelItem[];
        }> = [];

        if (existingCombos.length > 0) {
            result.push({
                id: "combos",
                name: "Combos",
                isCombo: true,
                models: existingCombos.map((combo) => ({
                    id: combo,
                    name: combo,
                    providerId: "combos",
                    providerName: "Combos"
                }))
            });
        }

        const providerModelsMap = new Map<string, ComboModelItem[]>();

        providerModelsMap.set("antigravity", ANTIGRAVITY_STATIC_MODELS);

        const liveModels = modelsData?.data ?? [];
        for (const m of liveModels) {
            let providerId = "custom";
            let modelId = m.id;

            if (m.id.includes("/")) {
                const parts = m.id.split("/");
                providerId = parts[0] || "custom";
                modelId = parts.slice(1).join("/");
            } else if (m.owned_by) {
                providerId = m.owned_by;
            }

            const kp = KNOWN_PROVIDERS.find((p) => p.id === providerId || p.alias === providerId);
            const providerName = kp ? kp.name : providerId.toUpperCase();

            if (!providerModelsMap.has(providerId)) {
                providerModelsMap.set(providerId, []);
            }

            const existingList = providerModelsMap.get(providerId)!;
            const fullId = m.id.includes("/") ? m.id : `${providerId}/${m.id}`;

            if (!existingList.some((item) => item.id === fullId)) {
                existingList.push({
                    id: fullId,
                    name: formatModelDisplayName(modelId),
                    providerId,
                    providerName
                });
            }
        }

        for (const kp of KNOWN_PROVIDERS) {
            if (kp.id === "antigravity") continue;
            if (!providerModelsMap.has(kp.id) && FALLBACK_PROVIDER_MODELS[kp.id]) {
                providerModelsMap.set(kp.id, FALLBACK_PROVIDER_MODELS[kp.id]!);
            }
        }

        for (const [providerId, models] of providerModelsMap.entries()) {
            const kp = KNOWN_PROVIDERS.find((p) => p.id === providerId || p.alias === providerId);
            result.push({
                id: providerId,
                name: kp ? kp.name.split(" ")[0] || kp.name : providerId.toUpperCase(),
                models
            });
        }

        return result;
    }, [existingCombos, modelsData]);

    const filteredGroups = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return groups;

        return groups
            .map((group) => {
                const matchingModels = group.models.filter(
                    (m) =>
                        m.name.toLowerCase().includes(query) ||
                        m.id.toLowerCase().includes(query) ||
                        group.name.toLowerCase().includes(query)
                );
                return { ...group, models: matchingModels };
            })
            .filter((group) => group.models.length > 0);
    }, [groups, search]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 sm:p-6"
            onClick={onClose}
        >
            <div
                className="relative flex flex-col w-full max-w-xl max-h-[85vh] rounded-2xl border border-zinc-800 bg-[#161618] text-zinc-100 shadow-2xl overflow-hidden font-sans"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 bg-[#121214]">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                            <span className="size-3 rounded-full bg-[#ff5f56] inline-block shadow-xs" />
                            <span className="size-3 rounded-full bg-[#ffbd2e] inline-block shadow-xs" />
                            <span className="size-3 rounded-full bg-[#27c93f] inline-block shadow-xs" />
                        </div>
                        <h3 className="text-sm font-bold text-zinc-100 ml-2">Add Model to Combo</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex flex-col gap-3.5 p-4 sm:p-5 overflow-y-auto">
                    <div className="rounded-xl border border-red-950/60 bg-red-950/20 p-3 flex items-start gap-2.5">
                        <Info className="size-4 text-orange-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-zinc-300 leading-relaxed font-normal">
                            Click to add, click again to remove. Changes are saved automatically.
                        </p>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search..."
                            className="w-full h-9 rounded-lg border border-zinc-800 bg-[#1c1c1f] pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all font-mono"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-4 pt-1">
                        {filteredGroups.length === 0 ? (
                            <div className="py-8 text-center text-xs text-zinc-500 font-mono">
                                No models found matching &ldquo;{search}&rdquo;
                            </div>
                        ) : (
                            filteredGroups.map((group) => (
                                <div key={group.id} className="space-y-2">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-orange-400">
                                        {group.isCombo ? (
                                            <Layers className="size-3.5 text-orange-400" />
                                        ) : (
                                            <ProviderIcon
                                                providerId={group.id}
                                                className="size-3.5"
                                            />
                                        )}
                                        <span>{group.name}</span>
                                        <span className="text-zinc-500 font-normal text-xs ml-0.5">
                                            ({group.models.length})
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {group.models.map((model) => {
                                            const isSelected = selectedSet.has(model.id);
                                            const { hasVision, hasThinking } = getModelCapabilities(
                                                model.id,
                                                model.name
                                            );

                                            return (
                                                <button
                                                    key={model.id}
                                                    type="button"
                                                    onClick={() => onToggleModel(model)}
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer border select-none ${
                                                        isSelected
                                                            ? "bg-orange-500/15 border-orange-500/70 text-orange-300 ring-1 ring-orange-500/40 shadow-xs font-semibold"
                                                            : "bg-[#202024] border-zinc-800/80 text-zinc-300 hover:border-zinc-700 hover:bg-[#27272c] hover:text-white"
                                                    }`}
                                                >
                                                    <span>{model.name}</span>
                                                    {hasVision && (
                                                        <Eye className="size-3 text-sky-400 shrink-0" />
                                                    )}
                                                    {hasThinking && (
                                                        <Brain className="size-3 text-amber-400 shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="flex justify-end border-t border-zinc-800/80 px-4 py-3 bg-[#121214]">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-100 transition-colors cursor-pointer"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
