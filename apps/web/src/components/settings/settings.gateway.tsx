import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/hooks/useSettings";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings.ui";

interface GatewaySettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function GatewaySettings({ settings, updateSetting }: GatewaySettingsProps) {
    return (
        <SettingsSection
            index="02"
            title="Gateway"
            description="Timeouts, retry behavior, and OAuth token refresh cadence."
        >
            <SettingsRow
                title="Request Timeout"
                description="How long to wait for upstream LLM responses before aborting."
                control={<ValueBadge>{settings.requestTimeoutSec}s</ValueBadge>}
            />
            <div className="py-2">
                <SegmentedControl
                    options={[30, 60, 120, 180, 300].map((sec) => ({
                        value: sec,
                        label: `${sec}s`
                    }))}
                    value={settings.requestTimeoutSec}
                    onChange={(sec) => updateSetting("requestTimeoutSec", sec)}
                />
            </div>

            <SettingsRow
                title="Auto-Retry on 429"
                description="Exponential backoff retry when provider quotas trigger rate limits."
                control={
                    <Switch
                        checked={settings.autoRetryOn429}
                        onCheckedChange={(val) => updateSetting("autoRetryOn429", val)}
                    />
                }
            />
            {settings.autoRetryOn429 && (
                <div className="pl-4 space-y-2 py-2">
                    <SettingsRow
                        title="Max Retries"
                        control={
                            <SegmentedControl
                                options={[1, 2, 3, 5].map((r) => ({ value: r, label: `${r}x` }))}
                                value={settings.maxRetries}
                                onChange={(r) => updateSetting("maxRetries", r)}
                            />
                        }
                    />
                    <SettingsRow
                        title="Base Backoff"
                        control={
                            <SegmentedControl
                                options={[500, 1000, 2000].map((ms) => ({
                                    value: ms,
                                    label: `${ms}ms`
                                }))}
                                value={settings.retryDelayMs}
                                onChange={(ms) => updateSetting("retryDelayMs", ms)}
                            />
                        }
                    />
                </div>
            )}

            <SettingsRow
                title="Token Refresh Lead Time"
                description="Renew provider OAuth tokens this far before expiry."
                control={<ValueBadge>{settings.tokenRefreshLeadMin} min</ValueBadge>}
            />
            <div className="py-2">
                <SegmentedControl
                    options={[2, 5, 10, 15].map((min) => ({ value: min, label: `${min} min` }))}
                    value={settings.tokenRefreshLeadMin}
                    onChange={(min) => updateSetting("tokenRefreshLeadMin", min)}
                />
            </div>
        </SettingsSection>
    );
}
