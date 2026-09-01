import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Cpu,
    Database,
    Download,
    KeyRound,
    Palette,
    RotateCcw,
    Server,
    Shield,
    SlidersHorizontal,
    Terminal,
    ArrowUpCircle
} from "lucide-react";
import { toast } from "sonner";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { useTheme } from "@/context/Theme";
import { useSettings } from "@/hooks/useSettings";
import { useVersion } from "@/hooks/useVersion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

type SettingsTab =
    "security" | "gateway" | "appearance" | "logging" | "playground" | "data" | "system";

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
    const [activeTab, setActiveTab] = useState<SettingsTab>("security");

    // Fetch server settings from /v1/settings
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

    // Mutation to update server settings
    const updateServerMutation = useMutation({
        mutationFn: (newRequireApiKey: boolean) =>
            api.post("/v1/settings", {
                require_api_key: newRequireApiKey
            }),
        onSuccess: (_data, newRequireApiKey) => {
            queryClient.invalidateQueries({ queryKey: ["server_settings"] });
            toast.success(
                newRequireApiKey ? "API Key Authentication Required" : "Open Access Mode Enabled",
                {
                    description: newRequireApiKey
                        ? "Gateway endpoints will now require Bearer token authorization."
                        : "Gateway endpoints are now accessible without an API key."
                }
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

    const tabs: {
        id: SettingsTab;
        label: string;
        hint: string;
        icon: typeof Palette;
        hasBadge?: boolean;
    }[] = [
        { id: "security", label: "Security", hint: "API keys & password", icon: KeyRound },
        { id: "gateway", label: "Gateway", hint: "Timeouts & retries", icon: Server },
        { id: "appearance", label: "Appearance", hint: "Theme & density", icon: Palette },
        { id: "logging", label: "Logging", hint: "Privacy & retention", icon: Shield },
        { id: "playground", label: "Playground", hint: "Defaults & presets", icon: Terminal },
        { id: "data", label: "Data", hint: "Backup & storage", icon: Database },
        {
            id: "system",
            label: "System",
            hint: "Runtime diagnostics",
            icon: Cpu,
            hasBadge: hasUpdate
        }
    ];

    const activeMeta = tabs.find((t) => t.id === activeTab)!;

    if (isLoadingServerSettings) {
        return <SettingsSkeleton />;
    }

    return (
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 font-mono">
            {/* Header */}
            <header className="flex flex-col justify-between gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3.5">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-secondary/40 text-foreground shadow-2xs">
                        <SlidersHorizontal className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                            Control Plane
                        </p>
                        <div className="mt-1 flex items-center gap-2.5 flex-wrap">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                Settings
                            </h1>
                            {hasUpdate && latestVersion && (
                                <button
                                    type="button"
                                    onClick={() => setActiveTab("system")}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-500 transition-colors hover:bg-amber-500/20 cursor-pointer"
                                >
                                    <ArrowUpCircle className="size-3" />
                                    Update {latestVersion} available
                                </button>
                            )}
                        </div>
                        <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
                            Configure gateway routing, authentication, telemetry logging, and UI
                            preferences.
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={exportSettings}
                        className="h-8 cursor-pointer gap-1.5 border-border/70 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <Download className="size-3.5" />
                        Export
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={resetToDefaults}
                        className="h-8 cursor-pointer gap-1.5 border-border/70 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                    >
                        <RotateCcw className="size-3.5" />
                        Reset
                    </Button>
                </div>
            </header>

            {/* Layout: Sidebar Tabs + Content Panel */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr] items-start">
                {/* Navigation Tabs */}
                <nav
                    aria-label="Settings sections"
                    className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-4 md:flex-col md:overflow-visible"
                >
                    {tabs.map(({ id, label, hint, icon: Icon, hasBadge }) => {
                        const isActive = activeTab === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setActiveTab(id)}
                                className={cn(
                                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer whitespace-nowrap shrink-0",
                                    isActive
                                        ? "bg-secondary/60 ring-1 ring-border/70 text-foreground shadow-2xs"
                                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "size-4 shrink-0",
                                        isActive ? "text-foreground" : "text-muted-foreground/70"
                                    )}
                                />
                                <span className="min-w-0">
                                    <span className="block text-xs font-bold leading-tight">
                                        {label}
                                        {hasBadge && (
                                            <span className="ml-1.5 inline-flex rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold text-amber-500 align-middle">
                                                Update
                                            </span>
                                        )}
                                    </span>
                                    <span className="block text-[10px] leading-tight text-muted-foreground/70">
                                        {hint}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </nav>

                {/* Main Settings Panel */}
                <main className="min-w-0 space-y-4">
                    <div key={activeTab} className="animate-fade-in">
                        {activeTab === "security" && (
                            <SecuritySettings
                                requireApiKey={requireApiKey}
                                onToggleRequireApiKey={handleToggleRequireApiKey}
                                isUpdating={updateServerMutation.isPending}
                                apiBase={apiBase}
                            />
                        )}

                        {activeTab === "gateway" && (
                            <GatewaySettings settings={settings} updateSetting={updateSetting} />
                        )}

                        {activeTab === "appearance" && (
                            <AppearanceSettings
                                theme={theme}
                                toggleTheme={toggleTheme}
                                settings={settings}
                                updateSetting={updateSetting}
                            />
                        )}

                        {activeTab === "logging" && (
                            <LoggingSettings settings={settings} updateSetting={updateSetting} />
                        )}

                        {activeTab === "playground" && (
                            <PlaygroundSettings settings={settings} updateSetting={updateSetting} />
                        )}

                        {activeTab === "data" && (
                            <DataSettings
                                exportSettings={exportSettings}
                                importSettings={importSettings}
                                clearPlaygroundHistory={clearPlaygroundHistory}
                                resetToDefaults={resetToDefaults}
                                getStorageStats={getStorageStats}
                            />
                        )}

                        {activeTab === "system" && <SystemSettings apiBase={apiBase} />}
                    </div>
                    <p className="text-center text-[10px] text-muted-foreground/60">
                        {activeMeta.label} — {activeMeta.hint}
                    </p>
                </main>
            </div>
        </div>
    );
}
