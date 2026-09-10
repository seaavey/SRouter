import { Check, Moon, Sun, Palette } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { SettingsSection, SettingsRow, SegmentedControl } from "./settings.ui";

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
        <SettingsSection
            id="appearance"
            icon={Palette}
            tag="UI"
            title="Appearance & Interface"
            description="Visual color theme preferences and dashboard table density settings."
        >
            <SettingsRow
                title="Color Theme"
                description="Select interface color scheme or synchronize with operating system."
                control={
                    <div className="flex gap-2 font-sans">
                        <button
                            type="button"
                            onClick={(e) => theme !== "dark" && toggleTheme(e)}
                            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-none ${
                                theme === "dark"
                                    ? "border-ink bg-ink text-canvas font-semibold"
                                    : "border-hairline-soft bg-canvas text-text-muted hover:text-ink hover:bg-canvas-soft"
                            }`}
                        >
                            <Moon className="size-3.5" />
                            <span>Dark</span>
                            {theme === "dark" && <Check className="size-3" />}
                        </button>
                        <button
                            type="button"
                            onClick={(e) => theme !== "light" && toggleTheme(e)}
                            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-none ${
                                theme === "light"
                                    ? "border-ink bg-ink text-canvas font-semibold"
                                    : "border-hairline-soft bg-canvas text-text-muted hover:text-ink hover:bg-canvas-soft"
                            }`}
                        >
                            <Sun className="size-3.5" />
                            <span>Light</span>
                            {theme === "light" && <Check className="size-3" />}
                        </button>
                    </div>
                }
            />
            <SettingsRow
                title="Table Density"
                description="Set default row height and padding density in log and model tables."
                control={
                    <SegmentedControl
                        options={[
                            { value: "compact", label: "Compact" },
                            { value: "cozy", label: "Cozy" }
                        ]}
                        value={settings.uiDensity}
                        onChange={(density) => updateSetting("uiDensity", density)}
                    />
                }
            />
        </SettingsSection>
    );
}
