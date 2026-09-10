import { Check, ScrollText } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings.ui";

interface LoggingSettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function LoggingSettings({ settings, updateSetting }: LoggingSettingsProps) {
    const levels = [
        { id: "full" as const, label: "Full Payload" },
        { id: "metadata" as const, label: "Metadata Only" },
        { id: "disabled" as const, label: "Disabled" }
    ];

    return (
        <SettingsSection
            id="logging"
            icon={ScrollText}
            tag="Audit"
            title="Logging & Privacy"
            description="Request telemetry retention, token tracking granularity, and sensitive header redaction."
        >
            <div className="py-3 font-sans">
                <div className="flex gap-2 font-sans flex-wrap">
                    {levels.map(({ id, label }) => {
                        const isActive = settings.loggingLevel === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => updateSetting("loggingLevel", id)}
                                className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-none ${
                                    isActive
                                        ? "border-ink bg-ink text-canvas font-semibold"
                                        : "border-hairline-soft bg-canvas text-text-muted hover:text-ink hover:bg-canvas-soft"
                                }`}
                            >
                                <span>{label}</span>
                                {isActive && <Check className="size-3" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            <SettingsRow
                title="Log Retention"
                description="Auto-prune logs older than this threshold."
                control={
                    <ValueBadge>
                        {settings.logRetentionDays === 365
                            ? "1 Year"
                            : `${settings.logRetentionDays} Days`}
                    </ValueBadge>
                }
            />
            <div className="py-2 font-sans">
                <SegmentedControl
                    options={[7, 14, 30, 90, 365].map((days) => ({
                        value: days,
                        label: days === 365 ? "1 Year" : `${days}d`
                    }))}
                    value={settings.logRetentionDays}
                    onChange={(days) => updateSetting("logRetentionDays", days)}
                />
            </div>

            <SettingsRow
                title="Record Token Usage"
                description="Aggregate prompt/completion tokens for cost estimates on the dashboard."
                control={
                    <Switch
                        checked={settings.recordTokenUsage}
                        onCheckedChange={(val) => updateSetting("recordTokenUsage", val)}
                    />
                }
            />
            <SettingsRow
                title="Mask Sensitive Headers"
                description="Redact Authorization tokens in database records."
                control={
                    <Switch
                        checked={settings.maskSensitiveHeaders}
                        onCheckedChange={(val) => updateSetting("maskSensitiveHeaders", val)}
                    />
                }
            />
        </SettingsSection>
    );
}
