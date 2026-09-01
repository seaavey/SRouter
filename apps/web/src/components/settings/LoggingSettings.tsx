import { Shield, Database, Coins, Lock, Check } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings-ui";

interface LoggingSettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function LoggingSettings({ settings, updateSetting }: LoggingSettingsProps) {
    const loggingOptions = [
        {
            id: "full" as const,
            title: "Full Payload",
            badge: "Recommended",
            desc: "Store full prompt messages and completion responses for inspection in the Logs view."
        },
        {
            id: "metadata" as const,
            title: "Metadata Only",
            badge: "Privacy Focused",
            desc: "Log only timestamps, model IDs, token usage, and latency. Message contents are discarded."
        },
        {
            id: "disabled" as const,
            title: "Disabled",
            badge: "Zero Trace",
            desc: "Do not record any request logs to SQLite database. Quota and tokens are still calculated."
        }
    ] as const;

    return (
        <div className="space-y-5">
            <SettingsSection
                title="Logging, Privacy & Audit"
                description="Control data retention policies and request payload logging granularity stored in SQLite."
                icon={<Shield className="size-4" />}
            >
                {/* Logging Level */}
                <div className="space-y-3">
                    <label className="text-xs font-semibold text-foreground">
                        Request Payload Logging Level
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {loggingOptions.map(({ id, title, badge, desc }) => {
                            const isSelected = settings.loggingLevel === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => updateSetting("loggingLevel", id)}
                                    className={`flex flex-col text-left p-4 rounded-xl border transition-all cursor-pointer ${
                                        isSelected
                                            ? "border-foreground bg-muted/60 text-foreground ring-1 ring-foreground/20"
                                            : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-xs font-bold text-foreground">
                                            {title}
                                        </span>
                                        {isSelected ? (
                                            <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background">
                                                <Check className="size-2.5 stroke-[3]" />
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded-full border border-border/70 text-muted-foreground">
                                                {badge}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                                        {desc}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Log Retention */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="SQLite Log Retention Window"
                        description="Audit logs older than this threshold will be pruned automatically to conserve disk space."
                        control={
                            <ValueBadge>
                                {settings.logRetentionDays === 365
                                    ? "1 Year"
                                    : `${settings.logRetentionDays} Days`}
                            </ValueBadge>
                        }
                    />
                    <SegmentedControl
                        options={[7, 14, 30, 90, 365].map((days) => ({
                            value: days,
                            label: days === 365 ? "1 Year" : `${days}d`
                        }))}
                        value={settings.logRetentionDays}
                        onChange={(days) => updateSetting("logRetentionDays", days)}
                    />
                </div>

                {/* Privacy Switches */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <label className="text-xs font-semibold text-foreground">
                        Telemetry & Privacy Controls
                    </label>
                    <div className="rounded-xl border border-border/60 bg-muted/20 divide-y divide-border/50">
                        <SettingsRow
                            title="Record Token Usage & Pricing Estimates"
                            description="Aggregate prompt and completion tokens to calculate cost estimates on the Dashboard."
                            control={
                                <Switch
                                    checked={settings.recordTokenUsage}
                                    onCheckedChange={(val) =>
                                        updateSetting("recordTokenUsage", val)
                                    }
                                />
                            }
                            className="p-3.5"
                        />
                        <SettingsRow
                            title="Mask Sensitive Auth Headers in Logs"
                            description="Automatically redact Authorization tokens and provider credentials in database records."
                            control={
                                <Switch
                                    checked={settings.maskSensitiveHeaders}
                                    onCheckedChange={(val) =>
                                        updateSetting("maskSensitiveHeaders", val)
                                    }
                                />
                            }
                            className="p-3.5"
                        />
                    </div>
                </div>
            </SettingsSection>
        </div>
    );
}
