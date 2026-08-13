import type { ModelObject } from "@srouter/types";

export function providerFor(model: ModelObject): string {
    return model.owned_by ?? model.id.split("/")[0] ?? "srouter";
}

export function getProviderBadgeColor(provider: string): string {
    const p = provider.toLowerCase();
    if (p.includes("groq")) return "bg-amber-500/10 text-amber-500 border-amber-500/25";
    if (p.includes("openai")) return "bg-emerald-500/10 text-emerald-500 border-emerald-500/25";
    if (p.includes("anthropic")) return "bg-indigo-500/10 text-indigo-400 border-indigo-500/25";
    if (p.includes("openrouter")) return "bg-sky-500/10 text-sky-400 border-sky-500/25";
    if (p.includes("antigravity")) return "bg-purple-500/10 text-purple-400 border-purple-500/25";
    return "bg-secondary text-muted-foreground border-border/60";
}
