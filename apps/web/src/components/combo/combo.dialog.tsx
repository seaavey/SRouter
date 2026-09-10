import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Eye, Layers, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { ProviderIcon } from "@/components/providers";
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
        {
            id: "openai_codex/gpt-4o",
            name: "GPT-4o",
            providerId: "openai_codex",
            providerName: "OpenAI"
        },
        {
            id: "openai_codex/gpt-4o-mini",
            name: "GPT-4o Mini",
            providerId: "openai_codex",
            providerName: "OpenAI"
        },
        { id: "openai_codex/o1", name: "o1", providerId: "openai_codex", providerName: "OpenAI" },
        {
            id: "openai_codex/o3-mini",
            name: "o3-mini",
            providerId: "openai_codex",
            providerName: "OpenAI"
        }
    ],
    openai: [
        { id: "openai/gpt-4o", name: "GPT-4o", providerId: "openai", providerName: "OpenAI" },
        {
            id: "openai/gpt-4o-mini",
            name: "GPT-4o Mini",
            providerId: "openai",
            providerName: "OpenAI"
        },
        { id: "openai/o1", name: "o1", providerId: "openai", providerName: "OpenAI" },
        { id: "openai/o3-mini", name: "o3-mini", providerId: "openai", providerName: "OpenAI" }
    ],
    anthropic: [
        {
            id: "anthropic/claude-3-7-sonnet",
            name: "Claude 3.7 Sonnet (Thinking)",
            providerId: "anthropic",
            providerName: "Anthropic"
        },
        {
            id: "anthropic/claude-3-5-sonnet",
            name: "Claude 3.5 Sonnet",
            providerId: "anthropic",
            providerName: "Anthropic"
        },
        {
            id: "anthropic/claude-3-5-haiku",
            name: "Claude 3.5 Haiku",
            providerId: "anthropic",
            providerName: "Anthropic"
        }
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6"
            onClick={onClose}
        >
            <div
                className="relative flex flex-col w-full max-w-xl max-h-[85vh] rounded-3xl border border-hairline-soft bg-canvas text-ink shadow-none overflow-hidden font-sans"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-hairline-soft px-6 py-5 bg-canvas-soft/30">
                    <h3 className="text-base font-semibold text-ink font-sans">
                        Select Cascade Models
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="size-8 inline-flex items-center justify-center rounded-full text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex flex-col gap-4 p-6 overflow-y-auto">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter available models & providers…"
                            className="w-full h-10 rounded-full border border-hairline-soft bg-field pl-10 pr-4 text-xs text-ink placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-ink transition-all font-mono"
                        />
                    </div>

                    <div className="space-y-4 pt-1">
                        {filteredGroups.length === 0 ? (
                            <div className="py-8 text-center text-xs text-text-muted font-sans font-light">
                                No models found matching &ldquo;{search}&rdquo;
                            </div>
                        ) : (
                            filteredGroups.map((group) => (
                                <div key={group.id} className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-ink font-sans">
                                        {group.isCombo ? (
                                            <Layers className="size-3.5 text-text-muted" />
                                        ) : (
                                            <ProviderIcon
                                                providerId={group.id}
                                                className="size-3.5"
                                            />
                                        )}
                                        <span>{group.name}</span>
                                        <span className="text-text-muted font-normal text-xs ml-0.5">
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
                                                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer select-none font-mono ${
                                                        isSelected
                                                            ? "bg-ink text-canvas border-ink font-semibold"
                                                            : "bg-canvas border-hairline-soft text-ink hover:bg-canvas-soft"
                                                    }`}
                                                >
                                                    <span>{model.name}</span>
                                                    {hasVision && (
                                                        <Eye className="size-3 opacity-70 shrink-0" />
                                                    )}
                                                    {hasThinking && (
                                                        <Brain className="size-3 opacity-70 shrink-0" />
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

                <div className="flex justify-end border-t border-hairline-soft px-6 py-4 bg-canvas-soft/30">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full bg-ink text-canvas hover:opacity-90 px-6 py-2 text-xs font-semibold transition-colors cursor-pointer shadow-none"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
