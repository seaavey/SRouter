import { Check, Moon, Palette, Sun, LayoutGrid, Type } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { SettingsSection, SettingsRow, SegmentedControl } from "./settings-ui";

interface AppearanceSettingsProps {
    theme: "light" | "dark";
    toggleTheme: (event?: React.MouseEvent) => void;
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function AppearanceSettings({
    theme,
    toggleTheme,
    settings,
    updateSetting
}: AppearanceSettingsProps) {
    return (
        <div className="space-y-5">
            <SettingsSection
                title="Appearance & Interface"
                description="Customize your color palette, table density, and dashboard visual presentation."
                icon={<Palette className="size-4" />}
            >
                {/* Theme Selection */}
                <div className="space-y-3">
                    <label className="text-xs font-semibold text-foreground">
                        Color Theme Mode
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                        <button
                            type="button"
                            onClick={(e) => theme !== "dark" && toggleTheme(e)}
                            className={`group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                                theme === "dark"
                                    ? "border-foreground bg-muted/60 text-foreground ring-1 ring-foreground/20"
                                    : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-foreground">
                                        <Moon className="size-3.5" />
                                    </div>
                                    <span className="text-xs font-bold text-foreground">
                                        Dark Cockpit
                                    </span>
                                </div>
                                {theme === "dark" && (
                                    <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                                        <Check className="size-3 stroke-[3]" />
                                    </span>
                                )}
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5 space-y-1.5 opacity-90">
                                <div className="flex items-center justify-between">
                                    <div className="h-2 w-16 rounded bg-zinc-800" />
                                    <div className="h-2 w-6 rounded bg-zinc-700" />
                                </div>
                                <div className="h-1.5 w-full rounded bg-zinc-900" />
                                <div className="h-1.5 w-4/5 rounded bg-zinc-900" />
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={(e) => theme !== "light" && toggleTheme(e)}
                            className={`group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                                theme === "light"
                                    ? "border-foreground bg-muted/60 text-foreground ring-1 ring-foreground/20"
                                    : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-100 border border-zinc-200 text-foreground">
                                        <Sun className="size-3.5" />
                                    </div>
                                    <span className="text-xs font-bold text-foreground">
                                        Light Paper
                                    </span>
                                </div>
                                {theme === "light" && (
                                    <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                                        <Check className="size-3 stroke-[3]" />
                                    </span>
                                )}
                            </div>
                            <div className="rounded-md border border-zinc-200 bg-white p-2.5 space-y-1.5 opacity-90">
                                <div className="flex items-center justify-between">
                                    <div className="h-2 w-16 rounded bg-zinc-200" />
                                    <div className="h-2 w-6 rounded bg-zinc-300" />
                                </div>
                                <div className="h-1.5 w-full rounded bg-zinc-100" />
                                <div className="h-1.5 w-4/5 rounded bg-zinc-100" />
                            </div>
                        </button>
                    </div>
                </div>

                {/* UI Density */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Interface Table Density"
                        description="Control table row padding and vertical layout spacing across logs and model catalogs."
                        control={
                            <SegmentedControl
                                options={[
                                    { value: "compact", label: "Compact (Dense)" },
                                    { value: "cozy", label: "Cozy (Relaxed)" }
                                ]}
                                value={settings.uiDensity}
                                onChange={(density) => updateSetting("uiDensity", density)}
                            />
                        }
                    />
                </div>
            </SettingsSection>

            {/* Typography Callout */}
            <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground">
                    <Type className="size-4" />
                </div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                    <strong className="text-foreground">JetBrains Mono Engine:</strong> SRouter uses
                    monospaced typography throughout the operational cockpit for maximum visual
                    alignment of tokens, hashes, JSON payloads, and timestamps.
                </div>
            </div>
        </div>
    );
}
