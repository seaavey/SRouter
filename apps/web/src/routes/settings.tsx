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

    useEffect(() => {
        const sections = SECTIONS.map(({ id }) => document.getElementById(id)).filter(
            (section): section is HTMLElement => section !== null
        );
        if (sections.length === 0) return;

        const scrollContainer = document.getElementById("dashboard-scroll-container");
        if (!scrollContainer) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleSections = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

                const section = visibleSections[0]?.target;
                if (section instanceof HTMLElement) {
                    setActiveSection((active) => (active === section.id ? active : section.id));
                }
            },
            {
                root: scrollContainer,
                rootMargin: "-112px 0px -65% 0px",
                threshold: 0
            }
        );

        for (const section of sections) {
            observer.observe(section);
        }

        return () => {
            observer.disconnect();
        };
    }, [isLoadingServerSettings]);

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
        const scrollContainer = document.getElementById("dashboard-scroll-container");
        if (el && scrollContainer) {
            scrollContainer.scrollTo({
                top:
                    el.getBoundingClientRect().top -
                    scrollContainer.getBoundingClientRect().top +
                    scrollContainer.scrollTop -
                    16,
                behavior: "smooth"
            });
        }
    };

    if (isLoadingServerSettings) {
        return <SettingsSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            System Preferences
                        </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                            Gateway Settings.
                        </h1>
                        <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full border border-hairline-soft bg-canvas px-3 text-xs font-semibold font-mono text-text-muted">
                            v{currentVersion}
                        </span>
                        {hasUpdate && latestVersion && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 font-sans">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                Update: {latestVersion}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-base font-light text-text-muted font-sans max-w-3xl">
                        Configure upstream routing policies, security gates, logging pipelines, and
                        client preferences for this SRouter gateway node.
                    </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <button
                        type="button"
                        onClick={exportSettings}
                        className="inline-flex items-center gap-2 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft text-ink px-5 py-2 text-xs font-semibold cursor-pointer transition-colors shadow-none font-sans"
                    >
                        <UploadCloud className="size-3.5" />
                        <span>Export</span>
                    </button>
                    <button
                        type="button"
                        onClick={resetToDefaults}
                        className="inline-flex items-center gap-2 rounded-full border border-hairline-soft bg-canvas hover:bg-destructive/10 hover:border-destructive/30 text-text-muted hover:text-destructive px-5 py-2 text-xs font-semibold cursor-pointer transition-colors shadow-none font-sans"
                    >
                        <RotateCcw className="size-3.5" />
                        <span>Reset</span>
                    </button>
                </div>
            </header>

            <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8">
                <aside className="sticky top-14 z-20 -mx-3 border-y border-hairline-soft bg-canvas/95 px-3 py-2 backdrop-blur-md sm:-mx-5 sm:px-5 lg:top-20 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
                    <nav
                        aria-label="Settings sections"
                        className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-3xl border border-hairline-soft bg-canvas p-1.5 lg:w-48 lg:flex-col lg:items-stretch shadow-none"
                    >
                        {SECTIONS.map(({ id, label, icon: Icon }) => {
                            const isActive = activeSection === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => scrollToSection(id)}
                                    aria-current={isActive ? "location" : undefined}
                                    className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink lg:justify-start ${
                                        isActive
                                            ? "bg-ink text-canvas font-semibold shadow-none"
                                            : "text-text-muted hover:bg-canvas-soft hover:text-ink"
                                    }`}
                                >
                                    <Icon className="size-4" />
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

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
        </div>
    );
}
