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
            <div className="py-2.5">
                <div className="flex gap-1.5 font-mono">
                    {levels.map(({ id, label }) => {
                        const isActive = settings.loggingLevel === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => updateSetting("loggingLevel", id)}
                                className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
                                    isActive
                                        ? "border-foreground bg-foreground text-background font-semibold"
                                        : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {label}
                                {isActive && <Check className="size-2.5" />}
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
            <div className="py-2">
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
