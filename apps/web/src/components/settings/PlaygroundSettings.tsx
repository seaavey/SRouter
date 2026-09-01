import { Terminal, Sparkles, Sliders, Radio, Code2, Bot, FileJson, PenTool } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings-ui";

interface PlaygroundSettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const SYSTEM_PROMPT_PRESETS = [
    {
        name: "General Assistant",
        icon: Bot,
        prompt: "You are a helpful, versatile, and precise AI assistant."
    },
    {
        name: "Senior Engineer",
        icon: Code2,
        prompt: "You are a senior full-stack software engineer. Provide robust, clean, idiomatic code with clear explanations and best practices."
    },
    {
        name: "JSON Extractor",
        icon: FileJson,
        prompt: "You are an automated data extractor. Always output raw, valid JSON only without markdown formatting or introductory text."
    },
    {
        name: "Technical Writer",
        icon: PenTool,
        prompt: "You are an expert technical writer. Explain complex engineering concepts clearly using concise metaphors and structured tables."
    }
];

export function PlaygroundSettings({ settings, updateSetting }: PlaygroundSettingsProps) {
    return (
        <div className="space-y-5">
            <SettingsSection
                title="Playground & Model Defaults"
                description="Pre-populate default inference parameters when starting new sessions in the SRouter Playground."
                icon={<Terminal className="size-4" />}
            >
                {/* Temperature */}
                <div className="space-y-2">
                    <SettingsRow
                        title="Default Temperature"
                        control={<ValueBadge>{settings.defaultTemperature.toFixed(2)}</ValueBadge>}
                    />
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={settings.defaultTemperature}
                        onChange={(e) =>
                            updateSetting("defaultTemperature", parseFloat(e.target.value))
                        }
                        className="w-full accent-foreground cursor-pointer h-1.5 rounded-lg bg-muted appearance-none"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>0.0 (Deterministic)</span>
                        <span>0.7 (Balanced)</span>
                        <span>2.0 (Creative)</span>
                    </div>
                </div>

                {/* Top P */}
                <div className="space-y-2 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Default Top P (Nucleus Sampling)"
                        control={<ValueBadge>{settings.defaultTopP.toFixed(2)}</ValueBadge>}
                    />
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={settings.defaultTopP}
                        onChange={(e) => updateSetting("defaultTopP", parseFloat(e.target.value))}
                        className="w-full accent-foreground cursor-pointer h-1.5 rounded-lg bg-muted appearance-none"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>0.0 (Strict)</span>
                        <span>0.95 (Standard)</span>
                        <span>1.0 (Full Distribution)</span>
                    </div>
                </div>

                {/* Max Tokens */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Default Max Output Tokens"
                        description="Upper bound on tokens generated per single model completion."
                        control={
                            <ValueBadge>
                                {settings.defaultMaxTokens.toLocaleString()} tokens
                            </ValueBadge>
                        }
                    />
                    <SegmentedControl
                        options={[1024, 2048, 4096, 8192, 16384].map((tokens) => ({
                            value: tokens,
                            label: tokens >= 1000 ? `${tokens / 1024}k` : `${tokens}`
                        }))}
                        value={settings.defaultMaxTokens}
                        onChange={(tokens) => updateSetting("defaultMaxTokens", tokens)}
                    />
                </div>

                {/* Stream Toggle */}
                <div className="border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Stream Completion Tokens by Default"
                        description="Enable real-time token streaming animation in the playground chat window."
                        control={
                            <Switch
                                checked={settings.streamResponse}
                                onCheckedChange={(val) => updateSetting("streamResponse", val)}
                            />
                        }
                    />
                </div>

                {/* System Prompt */}
                <div className="space-y-3 border-t border-border/60 pt-5">
                    <SettingsRow
                        title="Default System Prompt"
                        description="Quick Preset Templates:"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {SYSTEM_PROMPT_PRESETS.map(({ name, icon: Icon, prompt }) => (
                            <button
                                key={name}
                                type="button"
                                onClick={() => updateSetting("systemPromptDefault", prompt)}
                                className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background hover:bg-muted/60 p-2.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                                <Icon className="size-3.5 shrink-0 text-foreground" />
                                <span className="truncate">{name}</span>
                            </button>
                        ))}
                    </div>
                    <textarea
                        rows={3}
                        value={settings.systemPromptDefault}
                        onChange={(e) => updateSetting("systemPromptDefault", e.target.value)}
                        placeholder="Enter default system instructions..."
                        className="w-full rounded-xl border border-border/70 bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>
            </SettingsSection>
        </div>
    );
}
