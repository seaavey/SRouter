import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { useTheme } from "@/context/Theme";
import { useSettings } from "@/hooks/useSettings";
import { useVersion } from "@/hooks/useVersion";
import { Button } from "@/components/ui/button";

import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { GatewaySettings } from "@/components/settings/GatewaySettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { LoggingSettings } from "@/components/settings/LoggingSettings";
import { PlaygroundSettings } from "@/components/settings/PlaygroundSettings";
import { DataSettings } from "@/components/settings/DataSettings";
import { SystemSettings } from "@/components/settings/SystemSettings";
import { SettingsSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/settings")({
    staticData: { title: "Settings" },
    component: SettingsPage
});

interface ServerSettingsResponse {
    require_api_key?: boolean;
    requireApiKey?: boolean;
    settings?: Record<string, string>;
}

function SettingsPage() {
    const queryClient = useQueryClient();
    const { theme, toggleTheme } = useTheme();
    const {
        settings,
        updateSetting,
        resetToDefaults,
        exportSettings,
        importSettings,
        clearPlaygroundHistory,
        getStorageStats
    } = useSettings();
    const { hasUpdate, latestVersion } = useVersion();

    const apiBase = getGatewayBaseUrl();

    const { data: serverSettings, isPending: isLoadingServerSettings } =
        useQuery<ServerSettingsResponse>({
            queryKey: ["server_settings"],
            queryFn: () => api.get<ServerSettingsResponse>("/v1/settings")
        });

    const [requireApiKey, setRequireApiKey] = useState<boolean>(false);

    useEffect(() => {
        if (serverSettings) {
            const val = serverSettings.require_api_key ?? serverSettings.requireApiKey;
            if (typeof val === "boolean") {
                setRequireApiKey(val);
            }
        }
    }, [serverSettings]);

    const updateServerMutation = useMutation({
        mutationFn: (newRequireApiKey: boolean) =>
            api.post("/v1/settings", { require_api_key: newRequireApiKey }),
        onSuccess: (_data, newRequireApiKey) => {
            queryClient.invalidateQueries({ queryKey: ["server_settings"] });
            toast.success(
                newRequireApiKey ? "API Key Authentication Required" : "Open Access Mode Enabled"
            );
        },
        onError: (err) => {
            toast.error("Failed to update security setting", {
                description: err instanceof Error ? err.message : "Unknown error"
            });
        }
    });

    const handleToggleRequireApiKey = (value: boolean) => {
        setRequireApiKey(value);
        updateServerMutation.mutate(value);
    };

    if (isLoadingServerSettings) {
        return <SettingsSkeleton />;
    }

    return (
        <div className="mx-auto w-full max-w-3xl font-mono">
            {/* Header */}
            <header className="flex items-center justify-between border-b border-border/70 pb-4 mb-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold text-foreground">Settings</h1>
                    {hasUpdate && latestVersion && (
                        <span className="text-[9px] font-bold tracking-wider uppercase text-amber-500 border border-amber-500/30 rounded-sm px-1.5 py-0.5">
                            {latestVersion}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={exportSettings}
                        className="text-[10px] text-muted-foreground hover:text-foreground border border-border/70 rounded px-2 py-1 cursor-pointer transition-colors"
                    >
                        Export
                    </button>
                    <button
                        type="button"
                        onClick={resetToDefaults}
                        className="text-[10px] text-muted-foreground hover:text-rose-500 border border-border/70 rounded px-2 py-1 cursor-pointer transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </header>

            {/* Single scrollable content */}
            <main className="min-w-0 pb-12">
                <SecuritySettings
                    requireApiKey={requireApiKey}
                    onToggleRequireApiKey={handleToggleRequireApiKey}
                    isUpdating={updateServerMutation.isPending}
                    apiBase={apiBase}
                />

                <GatewaySettings settings={settings} updateSetting={updateSetting} />

                <AppearanceSettings
                    theme={theme}
                    toggleTheme={toggleTheme}
                    settings={settings}
                    updateSetting={updateSetting}
                />

                <LoggingSettings settings={settings} updateSetting={updateSetting} />

                <PlaygroundSettings settings={settings} updateSetting={updateSetting} />

                <DataSettings
                    exportSettings={exportSettings}
                    importSettings={importSettings}
                    clearPlaygroundHistory={clearPlaygroundHistory}
                    resetToDefaults={resetToDefaults}
                    getStorageStats={getStorageStats}
                />

                <SystemSettings apiBase={apiBase} />
            </main>
        </div>
    );
}
