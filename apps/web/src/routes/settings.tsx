import { useState, useEffect, useRef } from "react";
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

    const isClickScrollingRef = useRef(false);
    const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        };
    }, []);

    // Track scroll position to update active section pill
    useEffect(() => {
        const sections = SECTIONS.map(({ id }) => document.getElementById(id)).filter(
            (section): section is HTMLElement => section !== null
        );
        if (sections.length === 0) return;

        const scrollContainer = document.getElementById("dashboard-scroll-container");
        if (!scrollContainer) return;

        const isMobile = window.innerWidth < 1024;
        const topMargin = isMobile ? "-60px" : "-16px";

        const observer = new IntersectionObserver(
            (entries) => {
                if (isClickScrollingRef.current) return;

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
                rootMargin: `${topMargin} 0px -60% 0px`,
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

    // On mobile, keep the active section tab centered in the horizontal scroll view using nav.scrollTo
    // (Never call scrollIntoView on activeBtn because it cancels the vertical page scroll!)
    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth < 1024) {
            const nav = document.querySelector('nav[aria-label="Settings sections"]');
            const activeBtn = document.querySelector(
                `[data-section-nav="${activeSection}"]`
            ) as HTMLElement | null;
            if (nav && activeBtn) {
                const scrollLeft =
                    activeBtn.offsetLeft - nav.clientWidth / 2 + activeBtn.clientWidth / 2;
                nav.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
            }
        }
    }, [activeSection]);

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
        isClickScrollingRef.current = true;
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = setTimeout(() => {
            isClickScrollingRef.current = false;
        }, 1000);

        const el = document.getElementById(id);
        const scrollContainer = document.getElementById("dashboard-scroll-container");
        if (el && scrollContainer) {
            const isMobile = window.innerWidth < 1024;
            const navOffset = isMobile ? 60 : 16;
            scrollContainer.scrollTo({
                top:
                    el.getBoundingClientRect().top -
                    scrollContainer.getBoundingClientRect().top +
                    scrollContainer.scrollTop -
                    navOffset,
                behavior: "smooth"
            });
        }
    };

    if (isLoadingServerSettings) {
        return <SettingsSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 sm:gap-8 font-sans pb-16">
            {/* Header */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            System Preferences
                        </p>
                    </div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                            Gateway Settings.
                        </h1>
                        <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full border border-hairline-soft bg-canvas px-2.5 text-xs font-semibold font-mono text-text-muted">
                            v{currentVersion}
                        </span>
                        {hasUpdate && latestVersion && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 font-sans">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                Update: {latestVersion}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs sm:text-sm text-text-muted font-light font-sans max-w-3xl leading-relaxed">
                        Configure upstream routing policies, security gates, logging pipelines, and
                        client preferences for this SRouter gateway node.
                    </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <button
                        type="button"
                        onClick={exportSettings}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft text-ink px-4 py-1.5 sm:px-5 sm:py-2 text-xs font-semibold cursor-pointer transition-colors shadow-none font-sans"
                    >
                        <UploadCloud className="size-3.5" />
                        <span>Export</span>
                    </button>
                    <button
                        type="button"
                        onClick={resetToDefaults}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas hover:bg-destructive/10 hover:border-destructive/30 text-text-muted hover:text-destructive px-4 py-1.5 sm:px-5 sm:py-2 text-xs font-semibold cursor-pointer transition-colors shadow-none font-sans"
                    >
                        <RotateCcw className="size-3.5" />
                        <span>Reset</span>
                    </button>
                </div>
            </header>

            <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8">
                {/* On mobile: pinned directly under Topbar without gaps (-top-4 -mx-4)
                    On desktop: sticky vertical sidebar in left column (lg:sticky lg:top-4) */}
                <aside className="sticky -top-4 -mx-4 z-20 border-b border-hairline-soft bg-canvas/95 px-4 py-2 backdrop-blur-md sm:-top-6 sm:-mx-6 sm:px-6 lg:static lg:top-4 lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none lg:w-48 lg:self-start lg:sticky">
                    <nav
                        aria-label="Settings sections"
                        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar lg:flex-col lg:items-stretch lg:rounded-3xl lg:border lg:border-hairline-soft lg:bg-canvas lg:p-1.5 shadow-none"
                    >
                        {SECTIONS.map(({ id, label, icon: Icon }) => {
                            const isActive = activeSection === id;
                            return (
                                <button
                                    key={id}
                                    data-section-nav={id}
                                    type="button"
                                    onClick={() => scrollToSection(id)}
                                    aria-current={isActive ? "location" : undefined}
                                    className={`inline-flex min-h-8 sm:min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink lg:justify-start ${
                                        isActive
                                            ? "bg-ink text-canvas font-semibold shadow-none"
                                            : "text-text-muted hover:bg-canvas-soft hover:text-ink"
                                    }`}
                                >
                                    <Icon className="size-3.5 sm:size-4" />
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                <main className="space-y-6 min-w-0 pt-4 lg:pt-0">
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
