import { createFileRoute } from "@tanstack/react-router";
import { useTokenSaver } from "@/hooks/useTokenSaver";
import { TokenSaverHeader } from "@/components/tokenSaver/TokenSaverHeader";
import { ToolCompressionCard } from "@/components/tokenSaver/ToolCompressionCard";
import { PromptOptimizerCard } from "@/components/tokenSaver/PromptOptimizerCard";

export const Route = createFileRoute("/token-saver")({
    staticData: { title: "Token Saver" },
    component: TokenSaverPage
});

function TokenSaverPage() {
    const { settings, loading, saving, updateSettings } = useTokenSaver();

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse p-1 sm:p-2 font-mono">
                <div className="h-28 rounded-xl bg-card/60 border border-border/60" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="h-80 rounded-xl bg-card/60 border border-border/60" />
                    <div className="h-80 rounded-xl bg-card/60 border border-border/60" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12 font-mono">
            {/* Top Banner */}
            <TokenSaverHeader />

            {/* 2-Column Balanced Grid: Tool Output Compression & Prompt Optimizer */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* 1. Tool Output Compression (rtk) */}
                <ToolCompressionCard
                    settings={settings.compressToolOutput}
                    saving={saving}
                    onChange={(compressToolOutput) =>
                        updateSettings({
                            compressToolOutput: {
                                ...settings.compressToolOutput,
                                ...compressToolOutput
                            }
                        })
                    }
                />

                {/* 2. Prompt Biasing & Terse Output (Ponytail + Caveman) */}
                <PromptOptimizerCard
                    lazySettings={settings.lazySeniorDev}
                    terseSettings={settings.compressLlmOutput}
                    saving={saving}
                    onLazyChange={(lazySeniorDev) =>
                        updateSettings({
                            lazySeniorDev: {
                                ...settings.lazySeniorDev,
                                ...lazySeniorDev
                            }
                        })
                    }
                    onTerseChange={(compressLlmOutput) =>
                        updateSettings({
                            compressLlmOutput: {
                                ...settings.compressLlmOutput,
                                ...compressLlmOutput
                            }
                        })
                    }
                />
            </div>
        </div>
    );
}
