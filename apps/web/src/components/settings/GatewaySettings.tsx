import { Clock, RefreshCw, Server, Zap, Layers } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings-ui";

interface GatewaySettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function GatewaySettings({ settings, updateSetting }: GatewaySettingsProps) {
    return (
        <div className="space-y-5">
            <SettingsSection
                title="Gateway & Proxy"
                description="Configure upstream connection limits, timeout windows, and automatic rate-limit failover mechanics."
                icon={<Server className="size-4" />}
            >
                {/* Global Request Timeout */}
                <SettingsRow
                    title="Upstream Request Timeout"
                    description="Maximum duration the gateway will wait for upstream LLM streaming responses before aborting."
                    control={<ValueBadge>{settings.requestTimeoutSec}s</ValueBadge>}
                />
                <SegmentedControl
                    options={[30, 60, 120, 180, 300].map((sec) => ({
                        value: sec,
                        label: `${sec}s`
                    }))}
                    value={settings.requestTimeoutSec}
                    onChange={(sec) => updateSetting("requestTimeoutSec", sec)}
                />

                {/* Auto Retry on Rate Limit */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Auto-Retry on Rate Limit"
                        description="Automatically retry failed upstream requests with exponential backoff when provider quotas trigger 429 errors."
                        control={
                            <Switch
                                checked={settings.autoRetryOn429}
                                onCheckedChange={(val) => updateSetting("autoRetryOn429", val)}
                            />
                        }
                    />

                    {settings.autoRetryOn429 && (
                        <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                            <SettingsRow
                                title="Maximum Retry Attempts"
                                description="Number of sequential retry attempts before reporting failure."
                                control={
                                    <SegmentedControl
                                        options={[1, 2, 3, 5].map((retries) => ({
                                            value: retries,
                                            label: `${retries}x`
                                        }))}
                                        value={settings.maxRetries}
                                        onChange={(retries) => updateSetting("maxRetries", retries)}
                                    />
                                }
                            />
                            <SettingsRow
                                title="Base Backoff Delay"
                                description="Initial exponential sleep duration before the first retry attempt."
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
                </div>

                {/* Token Refresh Lead Time */}
                <SettingsRow
                    title="OAuth Token Refresh Lead Time"
                    description="Proactively renew provider OAuth tokens before expiry to ensure zero request disruption."
                    control={<ValueBadge>{settings.tokenRefreshLeadMin} min</ValueBadge>}
                />
                <SegmentedControl
                    options={[2, 5, 10, 15].map((min) => ({ value: min, label: `${min} min` }))}
                    value={settings.tokenRefreshLeadMin}
                    onChange={(min) => updateSetting("tokenRefreshLeadMin", min)}
                />
            </SettingsSection>

            {/* Architecture Info Banner */}
            <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground">
                    <Layers className="size-4" />
                </div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                    <strong className="text-foreground">Transparent Protocol Streaming:</strong> All
                    downstream clients receive raw Server-Sent Events (SSE) chunks immediately as
                    upstream providers output tokens, minimizing time-to-first-token (TTFT) without
                    proxy buffering overhead.
                </div>
            </div>
        </div>
    );
}
