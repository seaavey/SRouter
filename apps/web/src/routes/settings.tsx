import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    Activity,
    HardDrive,
    Palette,
    RotateCcw,
    ScrollText,
    ShieldCheck,
    Sliders,
    Sparkles,
    UploadCloud
} from "lucide-react";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { useTheme } from "@/context/Theme";
import { useSettings } from "@/hooks/useSettings";
import { useVersion } from "@/hooks/useVersion";
import {
    AppearanceSettings,
    DataSettings,
    GatewaySettings,
    LoggingSettings,
    SecuritySettings,
    SystemSettings
} from "@/components/settings";
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

const SECTIONS = [
    { id: "security", label: "Security", icon: ShieldCheck },
    { id: "gateway", label: "Gateway", icon: Sliders },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "logging", label: "Logging", icon: ScrollText },
    { id: "data", label: "Data", icon: HardDrive },
    { id: "system", label: "System", icon: Activity }
] as const;

function SettingsPage() {
    const queryClient = useQueryClient();
    const { theme, toggleTheme } = useTheme();
    const {
        settings,
        updateSetting,
        resetToDefaults,
        exportSettings,
        importSettings,
        clearStorage,
        getStorageStats
    } = useSettings();
    const { hasUpdate, latestVersion, currentVersion } = useVersion();
    const [activeSection, setActiveSection] = useState<string>("security");

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

    const scrollToSection = (id: string) => {
        setActiveSection(id);
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    };

    if (isLoadingServerSettings) {
        return <SettingsSkeleton />;
    }

    return (
        <div className="mx-auto w-full max-w-5xl font-mono pb-16 space-y-6">
            {/* Header: Tactical Machined Dashboard Bar */}
            <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-1 text-left min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                        System & Node Preferences
                    </p>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            Gateway Settings
                        </h1>
                        <span className="rounded border border-border/80 bg-secondary/60 px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                            v{currentVersion}
                        </span>
                        {hasUpdate && latestVersion && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                Update available: {latestVersion}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                        Configure upstream routing policies, security gates, logging pipelines, and client
                        preferences for this SRouter gateway node.
                    </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <button
                        type="button"
                        onClick={exportSettings}
                        className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-card hover:bg-secondary text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
                    >
                        <UploadCloud className="size-3.5" />
                        <span>Export</span>
                    </button>
                    <button
                        type="button"
                        onClick={resetToDefaults}
                        className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-card hover:bg-destructive/10 hover:border-destructive/40 text-muted-foreground hover:text-destructive px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
                    >
                        <RotateCcw className="size-3.5" />
                        <span>Reset</span>
                    </button>
                </div>
            </header>

            {/* Sticky/Subnav Quick Jump Tabs */}
            <div className="flex items-center gap-1 border border-border/80 p-1.5 bg-card/50 rounded-lg overflow-x-auto no-scrollbar">
                {SECTIONS.map(({ id, label, icon: Icon }) => {
                    const isActive = activeSection === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => scrollToSection(id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-medium transition-colors shrink-0 cursor-pointer ${
                                isActive
                                    ? "bg-foreground text-background font-semibold"
                                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                            }`}
                        >
                            <Icon className="size-3.5" />
                            <span>{label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Main Settings Sections */}
            <main className="space-y-6">
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

                <DataSettings
                    exportSettings={exportSettings}
                    importSettings={importSettings}
                    exportDatabase={api.exportDatabase}
                    importDatabase={api.importDatabase}
                    clearStorage={clearStorage}
                    resetToDefaults={resetToDefaults}
                    getStorageStats={getStorageStats}
                />

                <SystemSettings apiBase={apiBase} />
            </main>
        </div>
    );
}
